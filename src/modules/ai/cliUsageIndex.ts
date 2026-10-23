/**
 * CodeBuddy 会话记录索引：从 CLI 落盘的 JSONL 记录里汇总每一轮的积分与 tokens，作为用量页的明细主数据源。
 * 复用约定：目录规则与 CLI 一致（~/.codebuddy/projects/<压缩工作目录>/<sessionId>.jsonl），逐行解析 JSON，
 * 只取 providerData.conversationRequestId、rawUsage 与 toolResult 的 credit，不保留任何正文。
 * 关键约束：同一请求 id 往往有多条记录（用户消息、推理、助手消息、工具结果），积分与 tokens 必须累加而不是覆盖；
 * 时间取该轮最早记录的 timestamp（毫秒数，兼容秒数与 ISO 字符串），缺失时退化为会话文件写入时刻；
 * 整轮没有任何 credit 字段时视为未计费而不建条目；扫描带节流，翻页与切筛选不会反复读盘。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** 默认根目录：CLI 的会话记录目录 */
const DEFAULT_ROOT = path.join(os.homedir(), '.codebuddy', 'projects')
/** 节流窗口：同一窗口内的重复查询复用上次扫描结果 */
const REFRESH_INTERVAL_MS = 5_000
/** 目录递归深度：projects/<项目>/[<子目录>/]<sessionId>.jsonl，留一层余量 */
const MAX_DEPTH = 3
/** 秒级时间戳上界：小于该值的数字按秒换算，避免把十位秒数当毫秒解析成 1970 年 */
const SECOND_TIMESTAMP_LIMIT = 1e12
/** 提示词回显上限：与记账侧 PROMPT_MAX_LENGTH 保持一致，超出部分标记截断 */
const PROMPT_MAX_LENGTH = 20_000

/** 一轮请求在 CLI 记录里的汇总：用量页直接以它作为明细行 */
export interface CliUsageEntry {
    requestId: string
    /** 该轮累计积分（消息积分与工具调用积分之和）；整轮未上报 credit 时为 null */
    credit: number | null
    /** 该轮最早一条记录的时间（ISO）；无 timestamp 时退化为会话文件写入时刻 */
    createdAt: string
    /** 通道侧模型 id，空串表示未记录 */
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /**
     * 该轮是否调用了出图工具：按工具结果类型判定，与本地有没有记账行无关。
     * 历史出图（记账功能上线前）只能靠它归到「AI出图」，否则会被当成未归属。
     */
    isImageGeneration: boolean
    /** 该轮所属会话文件：取提示词时按需读取，不在索引里常驻正文 */
    sessionFile: string
}

/** 从会话记录里取回的一轮提示词 */
export interface CliPromptInfo {
    content: string
    isTruncated: boolean
}

/** 单条记录解析出的用量：timestamp 为 null 表示该行未带时间 */
interface ParsedUsage {
    requestId: string
    /** 该行未上报 credit 时为 null */
    credit: number | null
    timestamp: string | null
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    isImageGeneration: boolean
}

export class CliUsageIndex {
    /** 请求 id → 该轮汇总 */
    private entries = new Map<string, CliUsageEntry>()
    private lastRefreshAt = 0

    public constructor(private readonly rootDir: string = DEFAULT_ROOT) {}

    /** 全量重扫：打开用量页或点刷新时调用，保证看到最新写入的记录 */
    public refresh(): void {
        this.lastRefreshAt = Date.now()
        const entries = new Map<string, CliUsageEntry>()
        for (const file of listSessionFiles(this.rootDir)) {
            collectFile(file, entries)
        }
        this.entries = entries
    }

    /** 节流刷新：翻页、切筛选等高频路径使用，避免每次请求都全量读盘 */
    public ensureFresh(): void {
        if (Date.now() - this.lastRefreshAt < REFRESH_INTERVAL_MS) {
            return
        }
        this.refresh()
    }

    /** 全部轮次：用量页以它作为明细主数据源，积分即 CLI 记录的累计值 */
    public listEntries(): CliUsageEntry[] {
        return [...this.entries.values()]
    }

    /** 读取某轮真实积分：记录缺失或该轮未上报 credit 时返回 null */
    public readCredit(requestId: string | null): number | null {
        if (requestId === null) {
            return null
        }
        return this.entries.get(requestId)?.credit ?? null
    }

    /**
     * 按请求 id 取回该轮提示词：出图轮次优先取图像提示词，其余取用户消息原文。
     * 只在打开弹窗时读文件，正文不常驻内存；取不到时返回 null 由调用方显示缺失态。
     */
    public readPrompt(requestId: string): CliPromptInfo | null {
        const entry = this.entries.get(requestId)
        if (entry === undefined) {
            return null
        }
        let content: string
        try {
            content = fs.readFileSync(entry.sessionFile, 'utf8')
        } catch {
            return null
        }
        let userText: string | null = null
        for (const line of content.split('\n')) {
            const trimmed = line.trim()
            if (trimmed.length === 0 || !trimmed.includes(requestId)) {
                continue
            }
            let record: unknown
            try {
                record = JSON.parse(trimmed)
            } catch {
                continue
            }
            if (!isRecord(record)) {
                continue
            }
            const providerData = isRecord(record.providerData) ? record.providerData : null
            if (providerData === null || readString(providerData.conversationRequestId) !== requestId) {
                continue
            }
            const toolResult = isRecord(providerData.toolResult) ? providerData.toolResult : null
            const toolResponse = toolResult !== null && isRecord(toolResult.rawResponse) ? toolResult.rawResponse : null
            const imagePrompt = toolResponse === null ? null : readString(toolResponse.prompt)
            if (imagePrompt !== null) {
                return toPromptInfo(imagePrompt)
            }
            if (userText === null && readString(record.role) === 'user') {
                userText = readMessageText(record.content)
            }
        }
        return userText === null ? null : toPromptInfo(userText)
    }
}

/** 统一截断：与记账侧保持同一上限与截断标记 */
function toPromptInfo(text: string): CliPromptInfo {
    return {
        content: text.slice(0, PROMPT_MAX_LENGTH),
        isTruncated: text.length > PROMPT_MAX_LENGTH,
    }
}

/** 从消息内容块里拼出可读正文：只取文本块，忽略工具与推理块 */
function readMessageText(content: unknown): string | null {
    if (!Array.isArray(content)) {
        return null
    }
    const parts: string[] = []
    for (const block of content) {
        if (!isRecord(block)) {
            continue
        }
        const type = readString(block.type)
        if (type !== 'input_text' && type !== 'text') {
            continue
        }
        const text = readString(block.text)
        if (text !== null) {
            parts.push(text)
        }
    }
    return parts.length === 0 ? null : parts.join('\n')
}

/** 递归列出会话记录文件：读不到的目录直接跳过，不影响其它项目 */
function listSessionFiles(rootDir: string): string[] {
    const files: string[] = []
    const walk = (dir: string, depth: number): void => {
        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                if (depth < MAX_DEPTH) {
                    walk(full, depth + 1)
                }
            } else if (entry.name.endsWith('.jsonl')) {
                files.push(full)
            }
        }
    }
    walk(rootDir, 0)
    return files
}

/** 解析单个会话文件：坏行跳过，不让一条脏数据毁掉整份索引 */
function collectFile(file: string, target: Map<string, CliUsageEntry>): void {
    let content: string
    try {
        content = fs.readFileSync(file, 'utf8')
    } catch {
        return
    }
    /** 无 timestamp 记录的兜底时间：文件写入时刻即可近似该轮发生时间 */
    let fallbackTime: string
    try {
        fallbackTime = fs.statSync(file).mtime.toISOString()
    } catch {
        fallbackTime = new Date().toISOString()
    }
    for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) {
            continue
        }
        let record: unknown
        try {
            record = JSON.parse(trimmed)
        } catch {
            continue
        }
        const parsed = readRecordUsage(record)
        if (parsed === null) {
            continue
        }
        mergeUsage(target, parsed, fallbackTime, file)
    }
}

/**
 * 从一条记录取请求 id、积分、tokens 与时间。
 * 只要带请求 id 就建条目，未上报 credit 的轮次积分留空：明细要能与 CLI 记录逐条对上，
 * 不能因为某个字段缺失就把整轮隐藏掉。
 */
function readRecordUsage(record: unknown): ParsedUsage | null {
    if (!isRecord(record)) {
        return null
    }
    const providerData = record.providerData
    if (!isRecord(providerData)) {
        return null
    }
    const requestId = readString(providerData.conversationRequestId)
    if (requestId === null) {
        return null
    }
    const rawUsage = isRecord(providerData.rawUsage) ? providerData.rawUsage : null
    const toolResult = isRecord(providerData.toolResult) ? providerData.toolResult : null
    const toolResponse = toolResult !== null && isRecord(toolResult.rawResponse) ? toolResult.rawResponse : null
    const messageCredit = rawUsage === null ? null : readNumber(rawUsage.credit)
    const toolCredit = toolResponse === null ? null : readNumber(toolResponse.credit)
    return {
        requestId,
        credit: addCredit(messageCredit, toolCredit),
        timestamp: readTimestamp(record.timestamp),
        model: readString(providerData.model) ?? readString(providerData.requestModelName) ?? '',
        promptTokens: rawUsage === null ? 0 : (readNumber(rawUsage.prompt_tokens) ?? 0),
        completionTokens: rawUsage === null ? 0 : (readNumber(rawUsage.completion_tokens) ?? 0),
        totalTokens: rawUsage === null ? 0 : (readNumber(rawUsage.total_tokens) ?? 0),
        // 出图工具的结果自带 image_gen_tool_result 类型；图像模型名不在落盘记录里，只能确认「这轮是出图」
        isImageGeneration: toolResponse !== null && readString(toolResponse.type) === 'image_gen_tool_result',
    }
}

/** 积分相加：任一侧未知则沿用另一侧，两侧都未知保持 null（未知不得当成 0） */
function addCredit(left: number | null, right: number | null): number | null {
    if (left === null) {
        return right
    }
    if (right === null) {
        return left
    }
    return left + right
}

/** 合并同一轮的多条记录：积分与 tokens 累加，时间取最早的一条 */
function mergeUsage(
    target: Map<string, CliUsageEntry>,
    parsed: ParsedUsage,
    fallbackTime: string,
    sessionFile: string,
): void {
    const previous = target.get(parsed.requestId)
    if (previous === undefined) {
        target.set(parsed.requestId, {
            requestId: parsed.requestId,
            credit: parsed.credit,
            createdAt: parsed.timestamp ?? fallbackTime,
            model: parsed.model,
            promptTokens: parsed.promptTokens,
            completionTokens: parsed.completionTokens,
            totalTokens: parsed.totalTokens,
            isImageGeneration: parsed.isImageGeneration,
            sessionFile,
        })
        return
    }
    previous.credit = addCredit(previous.credit, parsed.credit)
    previous.promptTokens += parsed.promptTokens
    previous.completionTokens += parsed.completionTokens
    previous.totalTokens += parsed.totalTokens
    if (parsed.model.length > 0) {
        previous.model = parsed.model
    }
    previous.isImageGeneration = previous.isImageGeneration || parsed.isImageGeneration
    if (parsed.timestamp !== null && parsed.timestamp < previous.createdAt) {
        previous.createdAt = parsed.timestamp
    }
}

/** 时间解析：兼容毫秒数、秒数与 ISO 字符串，无法解析时返回 null */
function readTimestamp(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const time = new Date(value < SECOND_TIMESTAMP_LIMIT ? value * 1000 : value)
        return Number.isNaN(time.getTime()) ? null : time.toISOString()
    }
    if (typeof value !== 'string' || value.length === 0) {
        return null
    }
    const time = new Date(value)
    return Number.isNaN(time.getTime()) ? null : time.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}
