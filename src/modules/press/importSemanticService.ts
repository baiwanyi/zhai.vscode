/**
 * 导入语义归纳：读取素材里的章节首尾摘录，分批调用 AI 生成章节摘要，结果落到 _import/summaries.tsv。
 * 复用约定：正文素材与文件名由 importAnalysis 产出，模型选择取 ai/providers 的当前选择，
 * 配额按天记在 press.db 的 meta 表（独立键，不与外貌生成互相挤占），取消走 AbortSignal。
 * 关键约束：本阶段只产出数据文件，不修改章节文档——回填 Frontmatter 属于合并阶段，可反复重跑；
 * 断点续传以 summaries.tsv 已有序号为准，重跑只补缺失章节；失败与取消不占用配额。
 */

import * as vscode from 'vscode'
import { consumeToday, readUsedToday } from './db/quotaRepository'
import { MATERIAL_FILE_NAMES } from './importAnalysis'
import type { AiChatMessage, AiProvider, AiUsage } from '../ai/provider'
import type { QuotaKeys } from './db/quotaRepository'
import type { PressSemanticErrorCode, PressSemanticProgress } from '../../shared/types/press'
import type Database from 'better-sqlite3'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri } from '../common/storagePath'

/** 单批章节数：10 章约 6000 字素材，输出 10 行 TSV，兼顾吞吐与解析成功率 */
const BATCH_SIZE = 10

/** 单批输出上限：10 条摘要 + 元信息远低于该值，留足余量避免被截断 */
const MAX_TOKENS = 3000

/** 单批超时：模型排队时不宜无限等待，超时按失败处理并由用户重跑 */
const BATCH_TIMEOUT_MS = 120_000

/** 摘要长度上限：超出部分截断，防止模型输出整段评论 */
const SUMMARY_MAX_LENGTH = 80

/** 钩子类型白名单：与大纲章节字段的取值保持一致 */
const HOOKS = ['悬念', '反转', '情绪', '无'] as const

/** 配额键：与外貌生成分开计数，批量任务不挤占日常额度 */
const QUOTA_KEYS: QuotaKeys = {
    dateKey: 'press_import_summary_date',
    countKey: 'press_import_summary_count',
}

/** 素材表头：序号 / 标题 / 首段摘录 / 末段摘录 */
const HEADS_HEADER = '序号\t标题\t首段摘录\t末段摘录'

/** 摘要表头：序号 / 摘要 / 钩子 / 张力 */
const SUMMARIES_HEADER = '序号\t摘要\t钩子\t张力'

/** 章节素材行 */
interface HeadRow {
    order: number
    title: string
    head: string
    tail: string
}

/** 摘要行 */
interface SummaryRow {
    order: number
    summary: string
    hook: string
    tension: number
}

/** 语义归纳的最终结果 */
export interface SemanticOutcome {
    status: 'completed' | 'failed' | 'cancelled'
    done: number
    total: number
    generated: number
    dirPath: string
    code?: PressSemanticErrorCode
    message: string
}

/** 语义归纳失败：携带原因码，由上层转成前端可读文案 */
export class SemanticError extends Error {
    public constructor(
        public readonly code: PressSemanticErrorCode,
        message: string,
    ) {
        super(message)
        this.name = 'SemanticError'
    }
}

/** 拼接素材文件的绝对路径 */
function resolveMaterialFile(dirPath: string, relativePath: string): vscode.Uri {
    const root = resolveStorageRoot()
    const segments = dirPath.split('/').filter((segment) => segment.length > 0)
    return buildStorageUri(root, [...segments, ...relativePath.split('/')])
}

/** 读取文本文件：不存在时返回空串，供调用方区分「没有素材」与「素材为空」 */
async function readTextFile(uri: vscode.Uri): Promise<string> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(bytes)
    } catch {
        return ''
    }
}

/** 解析章节素材：跳过表头与列数不足的行，序号非正整数一律丢弃 */
function parseHeads(content: string): HeadRow[] {
    const rows: HeadRow[] = []
    for (const line of content.split(/\r?\n/u)) {
        if (line.trim().length === 0 || line.startsWith(HEADS_HEADER)) {
            continue
        }
        const columns = line.split('\t')
        if (columns.length < 4) {
            continue
        }
        const order = Number(columns[0])
        if (!Number.isInteger(order) || order <= 0) {
            continue
        }
        rows.push({ order, title: columns[1] ?? '', head: columns[2] ?? '', tail: columns[3] ?? '' })
    }
    return rows.sort((left, right) => left.order - right.order)
}

/** 读取已有摘要的序号集合：用于断点续传 */
function parseExistingOrders(content: string): Set<number> {
    const orders = new Set<number>()
    for (const line of content.split(/\r?\n/u)) {
        if (line.trim().length === 0 || line.startsWith(SUMMARIES_HEADER)) {
            continue
        }
        const order = Number(line.split('\t')[0])
        if (Number.isInteger(order) && order > 0) {
            orders.add(order)
        }
    }
    return orders
}

/** 解析已有摘要为结构化行，写回时与新结果合并排序 */
function parseExistingRows(content: string): SummaryRow[] {
    const rows: SummaryRow[] = []
    for (const line of content.split(/\r?\n/u)) {
        if (line.trim().length === 0 || line.startsWith(SUMMARIES_HEADER)) {
            continue
        }
        const columns = line.split('\t')
        const order = Number(columns[0])
        if (columns.length < 4 || !Number.isInteger(order) || order <= 0) {
            continue
        }
        const tension = Number(columns[3])
        rows.push({
            order,
            summary: columns[1] ?? '',
            hook: columns[2] ?? '无',
            tension: Number.isFinite(tension) ? Math.min(5, Math.max(1, Math.round(tension))) : 3,
        })
    }
    return rows
}

/** 构建摘要提示词：把素材与格式要求写死，减少模型自由发挥 */
function buildSummaryMessages(rows: HeadRow[]): AiChatMessage[] {
    const blocks = rows.map((row) => {
        const tail = row.tail.length > 0 ? row.tail : '（本章较短，末段与首段重合）'
        return `### ${String(row.order)} ${row.title}\n首段：${row.head}\n末段：${tail}`
    })
    return [
        {
            role: 'system',
            content: '你是小说编辑，只输出制表符分隔的纯文本，不做解释、不加 Markdown 代码块。',
        },
        {
            role: 'user',
            content: [
                '下面给出若干章节的标题与首尾摘录，请为每一章写一条客观梗概。',
                '',
                '要求：',
                '1. 梗概不超过 60 字，只写这一章发生了什么，不评价、不剧透后文。',
                '2. 判断章末钩子：悬念 / 反转 / 情绪 / 无，四选一。',
                '3. 张力取 1 到 5 的整数，5 表示冲突最激烈。',
                '4. 严格每行四列，用制表符分隔：序号、梗概、钩子、张力。',
                '5. 不要表头，不要额外说明，不要代码块围栏。',
                '6. 给出的每一个序号都必须有一行输出。',
                '',
                '章节素材：',
                blocks.join('\n\n'),
            ].join('\n'),
        },
    ]
}

/** 解析模型输出：只接受序号在请求范围内、列数与取值合法的行，其余丢弃并计数 */
function parseSummaryOutput(content: string, allowed: Set<number>): { rows: SummaryRow[]; dropped: number } {
    const rows: SummaryRow[] = []
    let dropped = 0
    const seen = new Set<number>()
    for (const rawLine of content.split(/\r?\n/u)) {
        const line = rawLine.replace(/^```[a-z]*$/iu, '').trim()
        if (line.length === 0) {
            continue
        }
        const columns = line.split('\t')
        const order = Number(columns[0])
        const isValid =
            columns.length >= 4 &&
            Number.isInteger(order) &&
            allowed.has(order) &&
            !seen.has(order) &&
            (HOOKS as readonly string[]).includes(columns[2] ?? '')
        if (!isValid) {
            dropped += 1
            continue
        }
        const tension = Number(columns[3])
        seen.add(order)
        rows.push({
            order,
            summary: (columns[1] ?? '').trim().slice(0, SUMMARY_MAX_LENGTH),
            hook: columns[2] ?? '无',
            tension: Number.isFinite(tension) ? Math.min(5, Math.max(1, Math.round(tension))) : 3,
        })
    }
    return { rows, dropped }
}

/** 序列化摘要：首行表头，其余按序号升序 */
function serializeSummaries(rows: SummaryRow[]): string {
    const lines = [SUMMARIES_HEADER]
    const sorted = [...rows].sort((left, right) => left.order - right.order)
    for (const row of sorted) {
        const summary = row.summary.replace(/[\t\r\n]+/gu, ' ').trim()
        lines.push([String(row.order), summary, row.hook, String(row.tension)].join('\t'))
    }
    return `${lines.join('\n')}\n`
}

/**
 * 导入语义归纳服务：一次只允许一个任务，按批生成章节摘要并落盘。
 * 关键约束：取消在批次边界生效，已写入的摘要保留；配额用尽时以 quota-exceeded 终止并保留进度。
 */
export class ImportSemanticService {
    private controller: AbortController | null = null
    private activeJobId = ''

    public constructor(
        private readonly db: Database.Database,
        private readonly provider: AiProvider,
    ) {}

    /**
     * 启动摘要归纳：读取素材、跳过已生成章节、分批调用模型。
     * @param jobId 由调用方生成并立即回传前端，用于过滤进度与取消
     * @param dirPath 作品目录，形如 press/{作品名}
     */
    public async start(
        jobId: string,
        dirPath: string,
        onProgress: (progress: PressSemanticProgress) => void,
    ): Promise<SemanticOutcome> {
        if (this.controller !== null) {
            throw new SemanticError('internal', '已有归纳任务在进行中，请等待完成或取消')
        }
        const ready = await this.provider.checkReady()
        if (!ready.ready) {
            throw new SemanticError('not-ready', ready.reason ?? 'AI 通道未就绪，请先登录或检查配置')
        }
        const headsUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.heads)
        const summariesUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries)
        const heads = parseHeads(await readTextFile(headsUri))
        if (heads.length === 0) {
            throw new SemanticError('no-material', '未找到章节素材，请先重新执行导入或素材抽取')
        }
        const existingContent = await readTextFile(summariesUri)
        const existingOrders = parseExistingOrders(existingContent)
        const merged = parseExistingRows(existingContent)
        const pending = heads.filter((row) => !existingOrders.has(row.order))
        const controller = new AbortController()
        this.controller = controller
        this.activeJobId = jobId
        let generated = 0
        let done = existingOrders.size
        const total = heads.length
        const emit = (status: PressSemanticProgress['status'], message: string): void => {
            onProgress({ jobId, stage: 'summary', status, done, total, generated, dirPath, message })
        }
        try {
            emit('running', done === total ? '摘要已全部存在' : `准备生成 ${String(pending.length)} 章摘要…`)
            for (let index = 0; index < pending.length; index += BATCH_SIZE) {
                if (controller.signal.aborted) {
                    logger.info(`摘要归纳已取消：${dirPath}，已完成 ${String(done)}/${String(total)}`)
                    return {
                        status: 'cancelled',
                        done,
                        total,
                        generated,
                        dirPath,
                        message: `已取消，已生成 ${String(generated)} 章摘要`,
                    }
                }
                this.assertQuota()
                const batch = pending.slice(index, index + BATCH_SIZE)
                const allowed = new Set(batch.map((row) => row.order))
                const content = await this.generateBatch(buildSummaryMessages(batch), controller.signal)
                const parsed = parseSummaryOutput(content, allowed)
                if (parsed.rows.length === 0) {
                    throw new SemanticError('internal', '模型未返回可解析的摘要，请重试')
                }
                if (parsed.dropped > 0) {
                    logger.warn(`摘要批次有 ${String(parsed.dropped)} 行被丢弃：${dirPath}`)
                }
                merged.push(...parsed.rows)
                await vscode.workspace.fs.writeFile(
                    summariesUri,
                    new TextEncoder().encode(serializeSummaries(merged)),
                )
                consumeToday(this.db, QUOTA_KEYS)
                generated += parsed.rows.length
                done = existingOrders.size + generated
                emit('running', `已生成 ${String(done)}/${String(total)} 章摘要 · ${String(Math.floor((done / total) * 100))}%`)
            }
            return {
                status: 'completed',
                done,
                total,
                generated,
                dirPath,
                message:
                    generated === 0
                        ? `摘要已全部存在，共 ${String(total)} 章`
                        : `已生成 ${String(generated)} 章摘要，累计 ${String(done)} 章`,
            }
        } catch (error) {
            if (error instanceof SemanticError) {
                // 配额用尽属于「暂停」而非「出错」：保留已完成进度，用户调大限额或次日续跑
                if (error.code === 'quota-exceeded') {
                    logger.info(`摘要归纳暂停：${dirPath}，已完成 ${String(done)}/${String(total)}`)
                    return {
                        status: 'failed',
                        done,
                        total,
                        generated,
                        dirPath,
                        code: 'quota-exceeded',
                        message: error.message,
                    }
                }
                throw error
            }
            const message = error instanceof Error ? error.message : String(error)
            logger.error(`摘要归纳失败：${dirPath}`, error)
            return {
                status: 'failed',
                done,
                total,
                generated,
                dirPath,
                code: controller.signal.aborted ? 'aborted' : 'internal',
                message: controller.signal.aborted ? '已取消' : `摘要归纳中断：${message}`,
            }
        } finally {
            this.controller = null
            this.activeJobId = ''
        }
    }

    /** 取消进行中的归纳：在下一个批次边界生效 */
    public cancel(jobId: string): { cancelled: boolean } {
        if (this.controller === null || this.activeJobId !== jobId) {
            return { cancelled: false }
        }
        this.controller.abort()
        return { cancelled: true }
    }

    /** 校验今日调用次数：限额为 0 视为不限制 */
    private assertQuota(): void {
        const limit = getZhaiConfig().pressImportAiDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, QUOTA_KEYS)
        if (used >= limit) {
            throw new SemanticError(
                'quota-exceeded',
                `今日语义归纳次数已用完（${String(used)} / ${String(limit)}），已完成部分保留，明日可续跑`,
            )
        }
    }

    /**
     * 生成单批摘要：累积流式增量，超时与外部取消都通过同一 AbortController 生效。
     * 关键约束：provider 不得持有跨请求状态，并发隔离由本方法的 controller 负责。
     */
    private async generateBatch(messages: AiChatMessage[], signal: AbortSignal): Promise<string> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS)
        const forwardAbort = (): void => controller.abort()
        signal.addEventListener('abort', forwardAbort)
        let content = ''
        let usage: AiUsage | null = null
        try {
            const stream = this.provider.stream({
                model: getSelectedCodebuddyModel(),
                maxTokens: MAX_TOKENS,
                messages,
                signal: controller.signal,
            })
            for await (const chunk of stream) {
                content += chunk.content
                if (chunk.usage) {
                    usage = chunk.usage
                }
            }
            if (usage !== null) {
                logger.info(`摘要批次用量：${String(usage.totalTokens)} tokens`)
            }
            return content
        } finally {
            clearTimeout(timer)
            signal.removeEventListener('abort', forwardAbort)
        }
    }
}
