/**
 * 导入语义归纳：按「章节摘要 → 卷纲 → 角色卡」的顺序分批调用 AI，产物平铺在作品的 _import/ 下；
 * 另可只跑角色卡阶段（提取人物卡），把既有或新生成的产物解析成人物卡草案回传。
 * 复用约定：素材与文件名由 importAnalysis 产出，模型选择取 ai/providers 的当前选择，
 * 配额按天记在 press.db 的 meta 表（独立键，不与外貌生成互相挤占），取消走 AbortSignal。
 * 关键约束：各阶段只产出数据文件，不修改章节文档——回填 Frontmatter 属于合并阶段，可反复重跑；
 * 阶段间以产物文件是否存在判断是否跳过，阶段内以已处理序号断点续传；
 * 提示词一律要求「信息不足就留空」，宁可缺字段也不接受编造。
 */

import * as vscode from 'vscode'
import { consumeToday, readUsedToday } from './db/quotaRepository'
import { MATERIAL_FILE_NAMES } from './importAnalysis'
import type { AiChatMessage, AiProvider, AiUsage } from '../ai/provider'
import type { QuotaKeys } from './db/quotaRepository'
import type {
    PressExtractedCharacter,
    PressSemanticErrorCode,
    PressSemanticProgress,
    PressSemanticStage,
} from '../../shared/types/press'
import type Database from 'better-sqlite3'
import { PRESS_IMPORT_DIR } from '../../shared/types/press'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri } from '../common/storagePath'

/** 摘要批次：10 章约 6000 字素材，输出 10 行 TSV，兼顾吞吐与解析成功率 */
const SUMMARY_BATCH_SIZE = 10

/** 卷纲批次：每组最多章节数，超过则按段切分，避免单次输入过长 */
const VOLUME_GROUP_SIZE = 60

/** 角色卡批次：每次处理几个角色，信息密度足够又不至于互相干扰 */
const CHARACTER_BATCH_SIZE = 4

/** 角色卡候选上限：只覆盖主要角色，长尾角色交由用户手工补 */
const CHARACTER_LIMIT = 20

/** 每个角色最多附多少条章节摘要作为依据 */
const CHARACTER_REFERENCE_LIMIT = 8

/** 角色标签上限：特质等分隔字段最多保留几项，与人物卡表单的条数保持一致 */
const MAX_TRAIT_LABELS = 8

/** 单批输出上限 */
const MAX_TOKENS = 3000

/** 单批超时：模型排队时不宜无限等待，超时按失败处理并由用户重跑 */
const BATCH_TIMEOUT_MS = 120_000

/** 摘要长度上限：超出部分截断，防止模型输出整段评论 */
const SUMMARY_MAX_LENGTH = 80

/** 钩子类型白名单：与大纲章节字段的取值保持一致 */
const HOOKS = ['悬念', '反转', '情绪', '无'] as const

/** 阶段执行顺序：后者依赖前者的产物 */
const STAGE_ORDER: readonly PressSemanticStage[] = ['summary', 'volumes', 'characters']

/** 阶段中文名：用于进度提示 */
const STAGE_LABELS: Readonly<Record<PressSemanticStage, string>> = {
    summary: '章节摘要',
    volumes: '卷纲',
    characters: '角色卡',
}

/** 配额键：与外貌生成分开计数，批量任务不挤占日常额度 */
const QUOTA_KEYS: QuotaKeys = {
    dateKey: 'press_import_summary_date',
    countKey: 'press_import_summary_count',
}

/** 素材表头 */
const HEADS_HEADER = '序号\t标题\t首段摘录\t末段摘录'
const SUMMARIES_HEADER = '序号\t摘要\t钩子\t张力'
const INDEX_HEADER = '序号\t卷\t标题\t字数\t路径'
const CANDIDATES_HEADER = '候选名\t出现次数\t首次章\t末次章\t高频共现\t高频章'

/** 卷纲与角色卡的产物文件名 */
const VOLUMES_FILE = 'volumes.md'
const CHARACTERS_FILE = 'characters.md'

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

/** 章节清单行 */
interface IndexRow {
    order: number
    volumeDir: string
    title: string
    charCount: number
}

/** 角色候选行 */
interface CandidateRow {
    name: string
    count: number
    firstOrder: number
    lastOrder: number
    partners: string[]
    topChapters: number[]
}

/** 单个阶段的执行结果 */
interface StageResult {
    generated: number
    /** 该阶段的处理总量与完成量，用于进度百分比 */
    done: number
    total: number
    /** 产物已存在或无待处理项时为 true，不计入「本轮生成」 */
    skipped: boolean
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

/** 写入文本文件 */
async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
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

/** 解析章节清单：卷名缺失视为未分卷 */
function parseIndex(content: string): IndexRow[] {
    const rows: IndexRow[] = []
    for (const line of content.split(/\r?\n/u)) {
        if (line.trim().length === 0 || line.startsWith(INDEX_HEADER)) {
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
        rows.push({
            order,
            volumeDir: columns[1] ?? '',
            title: columns[2] ?? '',
            charCount: Number(columns[3]) || 0,
        })
    }
    return rows.sort((left, right) => left.order - right.order)
}

/** 解析摘要行：张力夹到 1–5，钩子不在白名单时回退为「无」 */
function parseSummaries(content: string): SummaryRow[] {
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
        const hook = columns[2] ?? ''
        rows.push({
            order,
            summary: columns[1] ?? '',
            hook: (HOOKS as readonly string[]).includes(hook) ? hook : '无',
            tension: Number.isFinite(tension) ? Math.min(5, Math.max(1, Math.round(tension))) : 3,
        })
    }
    return rows.sort((left, right) => left.order - right.order)
}

/** 读取已有摘要的序号集合：用于断点续传 */
function parseExistingOrders(content: string): Set<number> {
    return new Set(parseSummaries(content).map((row) => row.order))
}

/** 解析角色候选：容忍旧格式（缺少「高频章」列时该字段为空数组） */
function parseCandidates(content: string): CandidateRow[] {
    const rows: CandidateRow[] = []
    for (const line of content.split(/\r?\n/u)) {
        if (line.trim().length === 0 || line.startsWith(CANDIDATES_HEADER)) {
            continue
        }
        const columns = line.split('\t')
        if (columns.length < 2) {
            continue
        }
        const name = (columns[0] ?? '').trim()
        const count = Number(columns[1])
        if (name.length === 0 || !Number.isFinite(count)) {
            continue
        }
        const topChapters = (columns[5] ?? '')
            .split(',')
            .map((item) => Number(item))
            .filter((order) => Number.isInteger(order) && order > 0)
        rows.push({
            name,
            count,
            firstOrder: Number(columns[2]) || 0,
            lastOrder: Number(columns[3]) || 0,
            partners: (columns[4] ?? '')
                .split(/\s+/u)
                .filter((item) => item.length > 0)
                .slice(0, 3),
            topChapters,
        })
    }
    return rows
}

/** 拆出二级标题区块：`## 角色名` 到下一个同级标题之间为一块，首个标题之前的内容忽略 */
function splitCharacterSections(content: string): { title: string; content: string }[] {
    const sections: { title: string; content: string }[] = []
    let current: { title: string; lines: string[] } | null = null
    for (const line of content.split(/\r?\n/u)) {
        const heading = /^##\s+(.+)$/u.exec(line)
        if (heading?.[1] !== undefined) {
            if (current !== null) {
                sections.push({ title: current.title, content: current.lines.join('\n') })
            }
            current = { title: heading[1].trim(), lines: [] }
            continue
        }
        if (current !== null) {
            current.lines.push(line)
        }
    }
    if (current !== null) {
        sections.push({ title: current.title, content: current.lines.join('\n') })
    }
    return sections
}

/** 读取「键：值」行：`-` 前缀可省略，中英文冒号都认，重复键与空键忽略 */
function readDashedValues(content: string): Map<string, string> {
    const values = new Map<string, string>()
    for (const line of content.split(/\r?\n/u)) {
        const match = /^\s*(?:[-*]\s*)?([^：:\s][^：:]{0,15})[：:]\s*(.*)$/u.exec(line)
        if (match === null) {
            continue
        }
        const key = (match[1] ?? '').trim()
        const value = (match[2] ?? '').trim()
        if (key.length === 0 || values.has(key)) {
            continue
        }
        values.set(key, value)
    }
    return values
}

/** 顿号、逗号与斜杠分隔的标签：去空并限量，防止模型输出整段文字挤进表单 */
function toTraitLabels(value: string): string[] {
    return value
        .split(/[、,，/|]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, MAX_TRAIT_LABELS)
}

/**
 * 解析角色卡产物：每块以「## 姓名」开头，字段按「键：值」读取，缺字段留空。
 * 关键约束：产物来自模型输出，字段可能缺失或改名，解析只让对应字段为空而不抛错；
 * 无姓名的块直接丢弃，避免把说明段落当成人物。导出仅供单测直接覆盖解析口径。
 */
export function parseCharacterDrafts(content: string): PressExtractedCharacter[] {
    const drafts: PressExtractedCharacter[] = []
    for (const section of splitCharacterSections(content)) {
        const values = readDashedValues(section.content)
        const name = (values.get('姓名') ?? section.title).trim()
        if (name.length === 0) {
            continue
        }
        drafts.push({
            name,
            role: values.get('分类') ?? '',
            gender: values.get('性别') ?? '',
            identity: values.get('身份') ?? '',
            traits: toTraitLabels(values.get('特质') ?? ''),
            desire: values.get('欲望') ?? '',
            weakness: values.get('弱点') ?? '',
            ability: values.get('能力') ?? '',
            arc: values.get('弧线') ?? '',
            relation: values.get('关系') ?? '',
        })
        if (drafts.length >= CHARACTER_LIMIT) {
            break
        }
    }
    return drafts
}

/** 提取终态文案：区分复用既有产物与本轮新生成，没有结果时给出下一步建议 */
function buildExtractMessage(result: StageResult, count: number): string {
    if (count === 0) {
        return result.skipped ? '未识别到角色候选：请先导入作品或重新执行素材抽取' : '本次没有生成可用的人物卡，请重试'
    }
    return result.skipped ? `已复用既有产物，读取 ${String(count)} 个人物` : `已提取 ${String(count)} 个人物`
}

/** 摘要序列化：首行表头，其余按序号升序 */
function serializeSummaries(rows: SummaryRow[]): string {
    const lines = [SUMMARIES_HEADER]
    const sorted = [...rows].sort((left, right) => left.order - right.order)
    for (const row of sorted) {
        const summary = row.summary.replace(/[\t\r\n]+/gu, ' ').trim()
        lines.push([String(row.order), summary, row.hook, String(row.tension)].join('\t'))
    }
    return `${lines.join('\n')}\n`
}

/** 构建摘要提示词 */
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

/** 解析摘要输出：只接受序号在请求范围内、列数与取值合法的行 */
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

/** 构建卷纲提示词：输入是逐章摘要，要求输出固定字段的 Markdown 片段 */
function buildVolumeMessages(
    groupLabel: string,
    rangeText: string,
    rows: { title: string; summary: string }[],
): AiChatMessage[] {
    const lines = rows.map((row, index) => `${String(index + 1)}. ${row.title}：${row.summary}`)
    return [
        {
            role: 'system',
            content: '你是小说编辑，只输出结构化 Markdown 片段，不做解释、不加代码块围栏。',
        },
        {
            role: 'user',
            content: [
                `下面是${groupLabel}（章节 ${rangeText}）的逐章摘要，请据此写出这一段的卷纲。`,
                '',
                '输出格式（严格照抄字段名，每字段一行，不要额外内容）：',
                `### ${groupLabel}`,
                `- 章节范围：${rangeText}`,
                '- 卷目标：一句话概括本段主角要达成什么',
                '- 卷冲突：一句话概括本段的核心对抗',
                '- 主要事件：三条，用分号分隔',
                '- 卷末钩子：一句话',
                '',
                '要求：',
                '1. 只依据给出的摘要，不要引入摘要里没有的人物或事件。',
                '2. 摘要信息不足以支撑某一字段时，该字段留空，不要编造。',
                '3. 不要输出标题层级之外的分隔线或总结。',
                '',
                '逐章摘要：',
                lines.join('\n'),
            ].join('\n'),
        },
    ]
}

/** 构建角色卡提示词：输入是候选角色的出场统计与相关章节摘要 */
function buildCharacterMessages(items: { candidate: CandidateRow; references: string[] }[]): AiChatMessage[] {
    const blocks = items.map(({ candidate, references }) => {
        const referenceText =
            references.length > 0 ? references.map((item) => `- ${item}`).join('\n') : '- （缺少可用摘要）'
        return [
            `角色：${candidate.name}`,
            `出场次数：${String(candidate.count)}`,
            `首次出现：第 ${String(candidate.firstOrder)} 章；末次出现：第 ${String(candidate.lastOrder)} 章`,
            `高频共现：${candidate.partners.length > 0 ? candidate.partners.join('、') : '无'}`,
            '相关章节摘要：',
            referenceText,
        ].join('\n')
    })
    return [
        {
            role: 'system',
            content: '你是小说编辑，只输出结构化 Markdown，不做解释、不加代码块围栏。',
        },
        {
            role: 'user',
            content: [
                '下面给出若干角色的出场统计与相关章节摘要，请为每个角色写一张人物卡。',
                '',
                '输出格式（每个角色一段，字段名严格照抄，每字段一行）：',
                '## 角色名',
                '- 姓名：角色名',
                '- 分类：主角 / 配角 / 反派 / 中立 / 龙套 之一',
                '- 性别：男 / 女 / 未知',
                '- 身份：',
                '- 特质：性格特征，用顿号分隔',
                '- 欲望：核心诉求',
                '- 弱点：',
                '- 能力：',
                '- 弧线：人物的变化轨迹',
                '- 关系：与他人关系，用顿号分隔',
                '',
                '要求：',
                '1. 只依据给出的摘要与统计，不要引入摘要里没有的情节。',
                '2. 摘要信息不足以判断的字段一律留空，不要猜测、不要编造。',
                '3. 不要输出总述、总结或角色之外的文字。',
                '',
                '角色素材：',
                blocks.join('\n\n'),
            ].join('\n'),
        },
    ]
}

/**
 * 导入语义归纳服务：一次只允许一个任务，按阶段顺序推进。
 * 关键约束：取消在批次边界生效，已完成阶段的产物保留；
 * 配额用尽时以 quota-exceeded 终止并保留进度，调大限额或次日续跑即可。
 */
export class ImportSemanticService {
    private controller: AbortController | null = null
    private activeJobId = ''

    public constructor(
        private readonly db: Database.Database,
        private readonly provider: AiProvider,
    ) {}

    /**
     * 启动语义归纳：依次执行摘要、卷纲、角色卡三个阶段，已完成阶段直接跳过。
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
        const heads = parseHeads(await readTextFile(headsUri))
        if (heads.length === 0) {
            throw new SemanticError('no-material', '未找到章节素材，请先重新执行导入或素材抽取')
        }
        const controller = new AbortController()
        this.controller = controller
        this.activeJobId = jobId
        let stage: PressSemanticStage = 'summary'
        let done = 0
        let total = heads.length
        let generated = 0
        const emit = (status: PressSemanticProgress['status'], message: string): void => {
            onProgress({ jobId, stage, status, done, total, generated, dirPath, message })
        }
        try {
            const results: StageResult[] = []
            for (const current of STAGE_ORDER) {
                if (controller.signal.aborted) {
                    logger.info(`语义归纳已取消：${dirPath}，停在 ${STAGE_LABELS[current]}`)
                    return {
                        status: 'cancelled',
                        done,
                        total,
                        generated,
                        dirPath,
                        message: `已取消，已完成 ${String(results.length)} 个阶段`,
                    }
                }
                stage = current
                const result = await this.runStage(dirPath, current, heads, controller.signal, (state) => {
                    done = state.done
                    total = state.total
                    emit('running', state.message)
                })
                generated += result.generated
                done = result.done
                total = result.total
                results.push(result)
            }
            emit('completed', this.buildSummaryMessage(results))
            return {
                status: 'completed',
                done,
                total,
                generated,
                dirPath,
                message: this.buildSummaryMessage(results),
            }
        } catch (error) {
            if (error instanceof SemanticError) {
                // 配额用尽属于「暂停」而非「出错」：保留已完成进度，用户调大限额或次日续跑
                if (error.code === 'quota-exceeded') {
                    logger.info(`语义归纳暂停：${dirPath}，已完成 ${String(done)}/${String(total)}`)
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
            logger.error(`语义归纳失败：${dirPath}`, error)
            return {
                status: 'failed',
                done,
                total,
                generated,
                dirPath,
                code: controller.signal.aborted ? 'aborted' : 'internal',
                message: controller.signal.aborted ? '已取消' : `语义归纳中断：${message}`,
            }
        } finally {
            this.controller = null
            this.activeJobId = ''
        }
    }

    /**
     * 提取人物卡：只跑角色卡阶段，并把产物解析成草案回传给调用方。
     * @param jobId 由调用方生成，用于进度广播与取消匹配
     * @param dirPath 作品目录，形如 press/{作品名}
     * 关键约束：产物已存在时直接复用，重复提取不消耗配额；与整篇归纳共用同一把单任务锁，
     * 同一时刻只能有一个归纳或提取任务在进行。
     */
    public async extractCharacters(
        jobId: string,
        dirPath: string,
        onProgress: (progress: PressSemanticProgress) => void,
    ): Promise<{ characters: PressExtractedCharacter[]; message: string }> {
        if (this.controller !== null) {
            throw new SemanticError('internal', '已有归纳任务在进行中，请等待完成或取消')
        }
        const ready = await this.provider.checkReady()
        if (!ready.ready) {
            throw new SemanticError('not-ready', ready.reason ?? 'AI 通道未就绪，请先登录或检查配置')
        }
        const controller = new AbortController()
        this.controller = controller
        this.activeJobId = jobId
        const emit = (status: PressSemanticProgress['status'], message: string, done: number, total: number): void => {
            onProgress({ jobId, stage: 'characters', status, done, total, generated: 0, dirPath, message })
        }
        try {
            const result = await this.runCharacters(dirPath, controller.signal, (state) => {
                emit('running', state.message, state.done, state.total)
            })
            const characters = parseCharacterDrafts(
                await readTextFile(resolveMaterialFile(dirPath, `${PRESS_IMPORT_DIR}/${CHARACTERS_FILE}`)),
            )
            const message = buildExtractMessage(result, characters.length)
            emit('completed', message, result.done, result.total)
            return { characters, message }
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

    /** 阶段汇总文案：只列出本轮真正生成内容的阶段 */
    private buildSummaryMessage(results: StageResult[]): string {
        const generatedParts: string[] = []
        for (const [index, stage] of STAGE_ORDER.entries()) {
            const result = results[index]
            if (result === undefined || result.skipped || result.generated === 0) {
                continue
            }
            generatedParts.push(`${STAGE_LABELS[stage]} ${String(result.generated)} 项`)
        }
        if (generatedParts.length === 0) {
            return '全部阶段均已完成，无需重新生成'
        }
        return `已生成 ${generatedParts.join('、')}`
    }

    /** 按阶段分派 */
    private async runStage(
        dirPath: string,
        stage: PressSemanticStage,
        heads: HeadRow[],
        signal: AbortSignal,
        onState: (state: { done: number; total: number; message: string }) => void,
    ): Promise<StageResult> {
        if (stage === 'summary') {
            return this.runSummary(dirPath, heads, signal, onState)
        }
        if (stage === 'volumes') {
            return this.runVolumes(dirPath, signal, onState)
        }
        return this.runCharacters(dirPath, signal, onState)
    }

    /** 阶段一：逐批生成章节摘要，写入 summaries.tsv */
    private async runSummary(
        dirPath: string,
        heads: HeadRow[],
        signal: AbortSignal,
        onState: (state: { done: number; total: number; message: string }) => void,
    ): Promise<StageResult> {
        const summariesUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries)
        const existingContent = await readTextFile(summariesUri)
        const existingOrders = parseExistingOrders(existingContent)
        const merged = parseSummaries(existingContent)
        const pending = heads.filter((row) => !existingOrders.has(row.order))
        const total = heads.length
        let done = existingOrders.size
        let generated = 0
        if (pending.length === 0) {
            onState({ done, total, message: '章节摘要已全部存在，跳过' })
            return { generated: 0, done, total, skipped: true }
        }
        for (let index = 0; index < pending.length; index += SUMMARY_BATCH_SIZE) {
            if (signal.aborted) {
                break
            }
            this.assertQuota()
            const batch = pending.slice(index, index + SUMMARY_BATCH_SIZE)
            const allowed = new Set(batch.map((row) => row.order))
            const content = await this.generate(buildSummaryMessages(batch), signal)
            const parsed = parseSummaryOutput(content, allowed)
            if (parsed.rows.length === 0) {
                throw new SemanticError('internal', '模型未返回可解析的摘要，请重试')
            }
            if (parsed.dropped > 0) {
                logger.warn(`摘要批次有 ${String(parsed.dropped)} 行被丢弃：${dirPath}`)
            }
            merged.push(...parsed.rows)
            await writeTextFile(summariesUri, serializeSummaries(merged))
            consumeToday(this.db, QUOTA_KEYS)
            generated += parsed.rows.length
            done = existingOrders.size + generated
            onState({
                done,
                total,
                message: `章节摘要 ${String(done)}/${String(total)} · ${String(Math.floor((done / total) * 100))}%`,
            })
        }
        return { generated, done, total, skipped: false }
    }

    /** 阶段二：按卷或按段聚合摘要，写出卷纲 */
    private async runVolumes(
        dirPath: string,
        signal: AbortSignal,
        onState: (state: { done: number; total: number; message: string }) => void,
    ): Promise<StageResult> {
        const volumesUri = resolveMaterialFile(dirPath, `${PRESS_IMPORT_DIR}/${VOLUMES_FILE}`)
        await vscode.workspace.fs.createDirectory(resolveMaterialFile(dirPath, PRESS_IMPORT_DIR))
        const existing = await readTextFile(volumesUri)
        if (existing.trim().length > 0) {
            onState({ done: 0, total: 0, message: '卷纲已存在，跳过' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        const indexRows = parseIndex(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.index)))
        const summaries = new Map(
            parseSummaries(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries))).map(
                (row) => [row.order, row.summary],
            ),
        )
        if (indexRows.length === 0 || summaries.size === 0) {
            onState({ done: 0, total: 0, message: '缺少章节清单或摘要，跳过卷纲' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        // 按卷分组；未分卷的章节落到同一组，超长时再按固定章数切段
        const groups = new Map<string, { order: number; title: string; summary: string }[]>()
        for (const row of indexRows) {
            const summary = summaries.get(row.order)
            if (summary === undefined) {
                continue
            }
            const label = row.volumeDir.length > 0 ? row.volumeDir : '未分卷'
            const bucket = groups.get(label) ?? []
            bucket.push({ order: row.order, title: row.title, summary })
            groups.set(label, bucket)
        }
        const sections: string[] = ['# 卷纲', '', '> 由 AI 依据逐章摘要归纳，未经原著核对。信息不足的字段留空。', '']
        const tasks: { label: string; range: string; rows: { title: string; summary: string }[] }[] = []
        for (const [label, rows] of groups) {
            const chunks = Math.ceil(rows.length / VOLUME_GROUP_SIZE)
            for (let index = 0; index < chunks; index += 1) {
                const slice = rows.slice(index * VOLUME_GROUP_SIZE, (index + 1) * VOLUME_GROUP_SIZE)
                const first = slice[0]
                const last = slice[slice.length - 1]
                if (first === undefined || last === undefined) {
                    continue
                }
                const suffix = chunks > 1 ? `（${String(index + 1)}/${String(chunks)}）` : ''
                tasks.push({
                    label: `${label}${suffix}`,
                    range: `${String(first.order)}–${String(last.order)}`,
                    rows: slice,
                })
            }
        }
        let generated = 0
        for (const [index, task] of tasks.entries()) {
            if (signal.aborted) {
                break
            }
            this.assertQuota()
            const content = await this.generate(buildVolumeMessages(task.label, task.range, task.rows), signal)
            const cleaned = content.replace(/^```[a-z]*$/giu, '').trim()
            if (cleaned.length === 0) {
                continue
            }
            sections.push(cleaned, '')
            consumeToday(this.db, QUOTA_KEYS)
            generated += 1
            onState({
                done: index + 1,
                total: tasks.length,
                message: `卷纲 ${String(index + 1)}/${String(tasks.length)} · ${task.label}`,
            })
        }
        await writeTextFile(volumesUri, `${sections.join('\n')}\n`)
        return { generated, done: tasks.length, total: tasks.length, skipped: false }
    }

    /** 阶段三：按候选表逐批生成角色卡，写出 characters.md */
    private async runCharacters(
        dirPath: string,
        signal: AbortSignal,
        onState: (state: { done: number; total: number; message: string }) => void,
    ): Promise<StageResult> {
        const charactersUri = resolveMaterialFile(dirPath, `${PRESS_IMPORT_DIR}/${CHARACTERS_FILE}`)
        await vscode.workspace.fs.createDirectory(resolveMaterialFile(dirPath, PRESS_IMPORT_DIR))
        const existing = await readTextFile(charactersUri)
        if (existing.trim().length > 0) {
            onState({ done: 0, total: 0, message: '角色卡已存在，跳过' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        const candidates = parseCandidates(
            await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.candidates)),
        )
            .sort((left, right) => right.count - left.count)
            .slice(0, CHARACTER_LIMIT)
        if (candidates.length === 0) {
            onState({ done: 0, total: 0, message: '未识别到角色候选，跳过角色卡' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        const summaries = new Map(
            parseSummaries(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries))).map(
                (row) => [row.order, row.summary],
            ),
        )
        const indexRows = parseIndex(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.index)))
        const titles = new Map(indexRows.map((row) => [row.order, row.title]))
        /** 为一个角色挑选依据章节：高频章优先，补充首现与末现章 */
        const collectReferences = (candidate: CandidateRow): string[] => {
            const orders = new Set<number>(candidate.topChapters)
            if (candidate.firstOrder > 0) {
                orders.add(candidate.firstOrder)
            }
            if (candidate.lastOrder > 0) {
                orders.add(candidate.lastOrder)
            }
            const references: string[] = []
            for (const order of [...orders].sort((left, right) => left - right)) {
                const summary = summaries.get(order)
                if (summary === undefined || summary.length === 0) {
                    continue
                }
                references.push(`第 ${String(order)} 章 ${titles.get(order) ?? ''}：${summary}`)
                if (references.length >= CHARACTER_REFERENCE_LIMIT) {
                    break
                }
            }
            return references
        }
        const sections: string[] = [
            '# 角色卡',
            '',
            '> 由 AI 依据出场统计与章节摘要生成，未经原著核对。信息不足的字段留空，请以原著为准修正。',
            '',
        ]
        const batches: CandidateRow[][] = []
        for (let index = 0; index < candidates.length; index += CHARACTER_BATCH_SIZE) {
            batches.push(candidates.slice(index, index + CHARACTER_BATCH_SIZE))
        }
        let generated = 0
        for (const [index, batch] of batches.entries()) {
            if (signal.aborted) {
                break
            }
            this.assertQuota()
            const items = batch.map((candidate) => ({ candidate, references: collectReferences(candidate) }))
            const content = await this.generate(buildCharacterMessages(items), signal)
            const cleaned = content.replace(/^```[a-z]*$/giu, '').trim()
            if (cleaned.length > 0) {
                sections.push(cleaned, '')
                generated += cleaned.split(/^##\s+/mu).length - 1
            }
            consumeToday(this.db, QUOTA_KEYS)
            onState({
                done: index + 1,
                total: batches.length,
                message: `角色卡 ${String(index + 1)}/${String(batches.length)}`,
            })
        }
        await writeTextFile(charactersUri, `${sections.join('\n')}\n`)
        return { generated, done: batches.length, total: batches.length, skipped: false }
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
     * 生成单批内容：累积流式增量，超时与外部取消都通过同一 AbortController 生效。
     * 关键约束：provider 不得持有跨请求状态，并发隔离由本方法的 controller 负责。
     */
    private async generate(messages: AiChatMessage[], signal: AbortSignal): Promise<string> {
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
                logger.info(`归纳批次用量：${String(usage.totalTokens)} tokens`)
            }
            return content
        } finally {
            clearTimeout(timer)
            signal.removeEventListener('abort', forwardAbort)
        }
    }
}
