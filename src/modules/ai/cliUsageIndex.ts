/**
 * CodeBuddy 会话记录索引：从 CLI 落盘的 JSONL 记录里读回每轮真实积分消耗，替代本地按倍率估算。
 * 复用约定：目录规则与 CLI 一致（~/.codebuddy/projects/<压缩工作目录>/<sessionId>.jsonl），逐行解析 JSON，
 * 只取 providerData.conversationRequestId 与 rawUsage/toolResult 的 credit，不保留任何正文；
 * 请求 id 与 SDK 的 _requestId 同源，可直接与本地用量行对账。
 * 关键约束：同一请求 id 往往有多条记录（用户消息、推理、助手消息、工具结果），积分必须累加而不是覆盖，
 * 工具调用自身也计费；整轮没有任何 credit 时视为未知（不建条目），调用方显示破折号而不是 0；
 * 扫描带节流，翻页与切筛选不会反复读盘，强制刷新只在打开页面时发生。
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

export class CliUsageIndex {
    /** 请求 id → 该轮累计积分 */
    private credits = new Map<string, number>()
    private lastRefreshAt = 0

    public constructor(private readonly rootDir: string = DEFAULT_ROOT) {}

    /** 全量重扫：打开用量页时调用，保证看到最新写入的记录 */
    public refresh(): void {
        this.lastRefreshAt = Date.now()
        const credits = new Map<string, number>()
        for (const file of listSessionFiles(this.rootDir)) {
            collectFile(file, credits)
        }
        this.credits = credits
    }

    /** 节流刷新：翻页、切筛选等高频路径使用，避免每次请求都全量读盘 */
    public ensureFresh(): void {
        if (Date.now() - this.lastRefreshAt < REFRESH_INTERVAL_MS) {
            return
        }
        this.refresh()
    }

    /** 读取某轮真实积分：记录缺失或该轮未上报 credit 时返回 null */
    public readCredit(requestId: string | null): number | null {
        if (requestId === null) {
            return null
        }
        return this.credits.get(requestId) ?? null
    }
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
function collectFile(file: string, target: Map<string, number>): void {
    let content: string
    try {
        content = fs.readFileSync(file, 'utf8')
    } catch {
        return
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
        const entry = readRecordCredit(record)
        if (entry === null) {
            continue
        }
        target.set(entry.requestId, (target.get(entry.requestId) ?? 0) + entry.credit)
    }
}

/** 从一条记录取请求 id 与本条记录产生的积分；本轮无任何 credit 字段时返回 null */
function readRecordCredit(record: unknown): { requestId: string; credit: number } | null {
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
    if (messageCredit === null && toolCredit === null) {
        return null
    }
    return { requestId, credit: (messageCredit ?? 0) + (toolCredit ?? 0) }
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
