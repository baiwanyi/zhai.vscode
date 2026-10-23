/**
 * 导入语义归纳：按「章节摘要 → 卷纲 → 角色卡 → 作品设定」的顺序分批调用 AI，产物平铺在作品的 Materials/ 下；
 * 另可只跑单个阶段（提取人物卡 / 重建大纲 / 归纳设定），把既有或新生成的产物解析成草案回传。
 * 复用约定：素材与文件名由 importAnalysis 产出，模型选择取 ai/providers 的当前选择，
 * 配额按天记在 press.db 的 meta 表（独立键，不与外貌生成互相挤占），取消走 AbortSignal。
 * 关键约束：各阶段只产出数据文件，不修改章节文档——回填 Frontmatter 属于合并阶段，可反复重跑；
 * 阶段间以产物文件是否存在判断是否跳过，阶段内以已处理序号断点续传；
 * 提示词一律要求「信息不足就留空」，宁可缺字段也不接受编造；
 * 归纳输入必须带原文片段（章节中段摘录、角色出场原文），只给摘要会让产出退化成二次概括。
 */

import * as vscode from 'vscode'
import { consumeToday, readUsedToday } from './db/quotaRepository'
import {
    MATERIAL_FILE_NAMES,
    analyzeProject,
    isLikelyPersonName,
    migrateLegacyMaterialDirectory,
} from './importAnalysis'
import type { AiChatMessage, AiProvider, AiUsage } from '../ai/provider'
import type { QuotaKeys } from './db/quotaRepository'
import type {
    PressExtractedChapter,
    PressExtractedCharacter,
    PressExtractedSetting,
    PressExtractedVolume,
    PressSemanticErrorCode,
    PressSemanticProgress,
    PressSemanticStage,
} from '../../shared/types/press'
import type Database from 'better-sqlite3'
import { LEGACY_PRESS_IMPORT_DIR, PRESS_IMPORT_DIR } from '../../shared/types/press'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri } from '../common/storagePath'

/** 摘要批次：6 章约 7200 字摘录，输出 6 行多列 TSV；批次调小是为了给「关键节点」与「出场」留够输出长度 */
const SUMMARY_BATCH_SIZE = 6

/** 卷纲批次：每组最多章节数，超过则按段切分，避免单次输入过长 */
const VOLUME_GROUP_SIZE = 40

/** 角色卡批次：每次处理几个角色，信息密度足够又不至于互相干扰 */
const CHARACTER_BATCH_SIZE = 3

/** 角色卡候选上限：覆盖主要与次要角色，长尾角色交由用户手工补 */
const CHARACTER_LIMIT = 30

/** 每个角色最多附多少条章节摘要作为依据 */
const CHARACTER_REFERENCE_LIMIT = 10

/** 每个角色最多附几段出场原文：原文是外貌、年龄、背景这类字段的唯一可靠来源 */
const CHARACTER_EVIDENCE_LIMIT = 4

/** 角色标签上限：特质等分隔字段最多保留几项，与人物卡表单的条数保持一致 */
const MAX_TRAIT_LABELS = 8

/** 单批输出上限 */
const MAX_TOKENS = 4000

/** 单批超时：模型排队时不宜无限等待，超时按失败处理并由用户重跑 */
const BATCH_TIMEOUT_MS = 150_000

/** 摘要长度上限：超出部分截断，防止模型输出整段评论 */
const SUMMARY_MAX_LENGTH = 140

/** 单章关键节点上限：与章纲节拍的可读性平衡，超过会被前端截断 */
const SUMMARY_BEAT_LIMIT = 4

/** 单章出场人物上限 */
const SUMMARY_CAST_LIMIT = 6

/** 钩子类型白名单：与大纲章节字段的取值保持一致 */
const HOOKS = ['悬念', '反转', '情绪', '无'] as const

/** 阶段执行顺序：后者依赖前者的产物 */
const STAGE_ORDER: readonly PressSemanticStage[] = ['summary', 'volumes', 'characters', 'setting']

/** 阶段中文名：用于进度提示 */
const STAGE_LABELS: Readonly<Record<PressSemanticStage, string>> = {
    summary: '章节摘要',
    volumes: '卷纲',
    characters: '角色卡',
    setting: '作品设定',
}

/** 配额键：与外貌生成分开计数，批量任务不挤占日常额度 */
const QUOTA_KEYS: QuotaKeys = {
    dateKey: 'press_import_summary_date',
    countKey: 'press_import_summary_count',
}

/**
 * 素材表头。
 * 关键约束：heads 的中段摘录排在末列、summaries 的关键节点与出场排在末列，
 * 这样旧版素材（少列）仍能按前几列解析，不会因为升级后未重抽素材而整表失效。
 */
const HEADS_HEADER = '序号\t标题\t首段摘录\t末段摘录\t中段摘录'
const SUMMARIES_HEADER = '序号\t摘要\t钩子\t张力\t关键节点\t出场'
const INDEX_HEADER = '序号\t卷\t标题\t字数\t路径'
const CANDIDATES_HEADER = '候选名\t出现次数\t首次章\t末次章\t高频共现\t高频章'

/** 卷纲、角色卡与设定草案的产物文件名 */
const VOLUMES_FILE = 'volumes.md'
const CHARACTERS_FILE = 'characters.md'
const SETTING_FILE = 'setting.md'

/** 设定提取取材的候选章上限：金手指候选很多，只取前若干章足以判断设定 */
const SETTING_CLUE_LIMIT = 20

/** 章节素材行 */
interface HeadRow {
    order: number
    title: string
    head: string
    tail: string
    /** 正文中段摘录：旧版素材没有该列，缺失时为空串 */
    middle: string
}

/** 摘要行：含本章关键节点与出场人物，供章纲节拍与出场人物回填 */
interface SummaryRow {
    order: number
    summary: string
    hook: string
    tension: number
    /** 关键节点与转折：逐条成为章纲节拍 */
    beats: string[]
    /** 出场人物名：前端按名称匹配人物卡 */
    cast: string[]
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

/**
 * 读取素材产物：新目录读不到时回退旧版的 `_import/`。
 * 关键约束：旧目录迁移失败（被占用、权限不足）时，已生成的 AI 初稿仍要能复用，
 * 否则一次迁移失败就会让用户白白重跑耗配额的角色卡与卷纲；
 * 回退只发生在新路径读空时，迁移成功后旧路径不存在，多一次 stat 级的失败读取，可忽略。
 */
async function readMaterialText(dirPath: string, relativePath: string): Promise<string> {
    const content = await readTextFile(resolveMaterialFile(dirPath, relativePath))
    if (content.length > 0) {
        return content
    }
    const legacyPath = `${LEGACY_PRESS_IMPORT_DIR}/${relativePath.slice(PRESS_IMPORT_DIR.length + 1)}`
    return readTextFile(resolveMaterialFile(dirPath, legacyPath))
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
        rows.push({
            order,
            title: columns[1] ?? '',
            head: columns[2] ?? '',
            tail: columns[3] ?? '',
            // 中段摘录是后加的列：旧素材没有该列，读不到就当作空串，不影响其它字段
            middle: columns[4] ?? '',
        })
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

/** 解析摘要行：张力夹到 1–5，钩子不在白名单时回退为「无」，关键节点与出场缺列时为空数组 */
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
            beats: splitLabels(columns[4] ?? '', SUMMARY_BEAT_LIMIT),
            cast: splitLabels(columns[5] ?? '', SUMMARY_CAST_LIMIT),
        })
    }
    return rows.sort((left, right) => left.order - right.order)
}

/**
 * 判断已有产物是否已包含本轮要求的关键字段。
 * 关键约束：产物非空不等于可用——旧版卷纲没有情节脉络、旧版角色卡没有外貌与背景，
 * 这类产物要被当作未完成并重跑一次，否则升级后用户点「提取」拿到的仍是旧内容。
 */
function isProductUpToDate(content: string, markers: readonly string[]): boolean {
    return content.trim().length > 0 && markers.every((marker) => content.includes(marker))
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

/** 区块标题正则：二级用于角色卡，三级用于卷纲 */
const SECTION_PATTERNS: Readonly<Record<2 | 3, RegExp>> = {
    2: /^##\s+(.+)$/u,
    3: /^###\s+(.+)$/u,
}

/** 拆出指定级别的标题区块：到下一个同级标题之间为一块，首个标题之前的内容忽略 */
function splitLevelSections(content: string, level: 2 | 3): { title: string; content: string }[] {
    const pattern = SECTION_PATTERNS[level]
    const sections: { title: string; content: string }[] = []
    let current: { title: string; lines: string[] } | null = null
    for (const line of content.split(/\r?\n/u)) {
        const heading = pattern.exec(line)
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

/**
 * 顿号、逗号、分号与斜杠分隔的标签：去空并限量，防止模型输出整段文字挤进表单。
 * 关键节点用分号分隔、出场人物用顿号分隔，两种写法都要能切开。
 */
function splitLabels(value: string, limit: number): string[] {
    return value
        .split(/[、,，;；/|]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, limit)
}

/** 特质标签：沿用表单的条数上限 */
function toTraitLabels(value: string): string[] {
    return splitLabels(value, MAX_TRAIT_LABELS)
}

/**
 * 模型在条目里自认「不是人物」的措辞：一旦出现说明模型只是在复述候选噪声，
 * 这类块必须丢弃——它们正是「时候」「东西」被写成角色卡的形态。
 */
const NEGATIVE_CHARACTER_HINTS: readonly string[] = [
    '原文无对应人物',
    '无对应人物',
    '没有对应人物',
    '不是一个人物',
    '并非一个人物',
    '并不是人物',
    '并非人物',
    '不是人物',
    '并非人名',
    '不是人名',
    '并非角色',
    '仅是普通词',
    '只是普通词',
    '不是具体人物',
    '并非具体人物',
    '普通词汇',
]

/** 判断一段角色块是否在自述「这不是人物」 */
function isRejectedDraft(content: string): boolean {
    return NEGATIVE_CHARACTER_HINTS.some((hint) => content.includes(hint))
}

/**
 * 判断一份人物卡是否完全没有内容：除姓名、分类与性别外没有任何可用的描述信息。
 * 关键约束：这类条目要么来自分词噪声，要么是模型对素材的敷衍填充，留进工作台只会制造垃圾卡片；
 * 真正的次要角色至少会有一条身份、特质、能力或关系，因此不会命中。
 */
function isEmptyDraft(draft: PressExtractedCharacter): boolean {
    const textFields = [
        draft.alias,
        draft.age,
        draft.height,
        draft.bodyType,
        draft.identity,
        draft.appearance,
        draft.background,
        draft.desire,
        draft.weakness,
        draft.catchphrase,
        draft.ability,
        draft.arc,
        draft.relation,
    ]
    return draft.traits.length === 0 && textFields.every((value) => value.trim().length === 0)
}

/**
 * 解析角色卡产物：每块以「## 姓名」开头，字段按「键：值」读取，缺字段留空。
 * 关键约束：产物来自模型输出，字段可能缺失或改名，解析只让对应字段为空而不抛错；
 * 无姓名的块、自认「不是人物」的块、非人名候选与全空条目全部丢弃——
 * 这是角色准确性的最后一道防线，素材层过滤得再严也无法阻止模型自行发挥。
 * 导出仅供单测直接覆盖解析口径。
 */
export function parseCharacterDrafts(content: string): PressExtractedCharacter[] {
    const drafts: PressExtractedCharacter[] = []
    for (const section of splitLevelSections(content, 2)) {
        if (isRejectedDraft(section.content)) {
            continue
        }
        const values = readDashedValues(section.content)
        const name = (values.get('姓名') ?? section.title).trim()
        if (name.length === 0 || !isLikelyPersonName(name)) {
            continue
        }
        const draft: PressExtractedCharacter = {
            name,
            alias: values.get('别名') ?? values.get('昵称') ?? '',
            role: values.get('分类') ?? '',
            gender: values.get('性别') ?? '',
            age: values.get('年龄') ?? '',
            height: values.get('身高') ?? values.get('身量') ?? '',
            bodyType: values.get('体型') ?? values.get('身材') ?? '',
            identity: values.get('身份') ?? '',
            appearance: values.get('外貌') ?? '',
            traits: toTraitLabels(values.get('特质') ?? values.get('性格') ?? ''),
            background: values.get('背景') ?? values.get('背景故事') ?? '',
            desire: values.get('欲望') ?? '',
            weakness: values.get('弱点') ?? '',
            catchphrase: values.get('口头禅') ?? '',
            ability: values.get('能力') ?? '',
            arc: values.get('弧线') ?? '',
            relation: values.get('关系') ?? '',
        }
        if (isEmptyDraft(draft)) {
            continue
        }
        drafts.push(draft)
        if (drafts.length >= CHARACTER_LIMIT) {
            break
        }
    }
    return drafts
}

/**
 * 清洗模型输出的角色块：逐块过滤后再落盘，让 characters.md 本身不含噪声条目。
 * 关键约束：只保留「有姓名、非非人名、且至少有一个描述字段」的块；前言、总结与被否定的块一并丢弃，
 * 这样即使模型又把「时候」写成一段带解释的条目，产物文件也不会被污染。
 */
function filterCharacterOutput(content: string): string {
    const blocks: string[] = []
    for (const section of splitLevelSections(content, 2)) {
        if (isRejectedDraft(section.content)) {
            continue
        }
        const values = readDashedValues(section.content)
        const name = (values.get('姓名') ?? section.title).trim()
        if (name.length === 0 || !isLikelyPersonName(name)) {
            continue
        }
        const block = `## ${section.title}\n${section.content.trim()}`
        if (parseCharacterDrafts(block).length === 0) {
            continue
        }
        blocks.push(block)
    }
    return blocks.join('\n\n')
}

/** 常见高频虚词：正常中文正文必然大量出现，命中率极低说明正文已被解码成乱码 */
const COMMON_HAN_CHARS = '的一是不了在人有我他这个们中来上大为和地到以说时要就出会可也你对生能而子那得于着下'

/** 判断素材是否像乱码：取首段样例，高频虚词占比低于 1% 视为正文不可读 */
function looksGarbled(text: string): boolean {
    const sample = text.slice(0, 2000)
    if (sample.length === 0) {
        return false
    }
    let hits = 0
    for (const char of sample) {
        if (COMMON_HAN_CHARS.includes(char)) {
            hits += 1
        }
    }
    return hits / sample.length < 0.01
}

/** 提取终态文案：区分复用既有产物与本轮新生成，没有结果时给出下一步建议 */
function buildExtractMessage(result: StageResult, count: number, isGarbled: boolean): string {
    if (count === 0) {
        if (isGarbled) {
            return '素材正文读不出正常中文（疑似编码异常），请重新导入该作品的原始 TXT'
        }
        return result.skipped ? '素材里没有识别到人名候选，可手工新增人物' : '本次没有生成可用的人物卡，请重试'
    }
    return result.skipped ? `已复用既有产物，读取 ${String(count)} 个人物` : `已提取 ${String(count)} 个人物`
}

/** 金手指候选线索：命中的章、标题与关键词 */
interface GoldenClue {
    order: number
    title: string
    words: string
}

/** 解析金手指候选表：`- 第 N 章 标题：分类:词、分类:词` */
function parseGoldenClues(text: string): GoldenClue[] {
    const clues: GoldenClue[] = []
    for (const line of text.split(/\r?\n/u)) {
        const matched = /^\s*-\s*第\s*(\d+)\s*章\s*(.*?)[：:]\s*(.+)$/u.exec(line)
        if (matched === null) {
            continue
        }
        const order = Number(matched[1])
        if (!Number.isInteger(order) || order <= 0) {
            continue
        }
        clues.push({ order, title: (matched[2] ?? '').trim(), words: (matched[3] ?? '').trim() })
    }
    return clues
}

/**
 * 解析角色出场原文摘录：按「## 姓名」切块，块内以 `- ` 开头的行即证据（含统计行）。
 * 关键约束：块名即角色名，与候选表同名，因此调用方可以直接按名字取用。
 */
function parseEvidence(text: string): Map<string, string[]> {
    const evidence = new Map<string, string[]>()
    for (const section of splitLevelSections(text, 2)) {
        const lines = section.content
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line.startsWith('- '))
            .map((line) => line.slice(2).trim())
            .filter((line) => line.length > 0)
        if (lines.length > 0) {
            evidence.set(section.title, lines)
        }
    }
    return evidence
}

/**
 * 组装设定归纳的取材章：金手指候选章与世界构建候选章合并去重，按章序取前若干章。
 * 关键约束：两类关键词一个都没命中时（日常流、都市流很常见），回落到代表章节，
 * 否则设定提取会直接返回「没有素材」，用户拿到的是一份空设定。
 */
async function resolveSettingClues(
    dirPath: string,
    goldenClues: readonly GoldenClue[],
    worldClues: readonly GoldenClue[],
): Promise<GoldenClue[]> {
    const merged = new Map<number, GoldenClue>()
    for (const clue of [...goldenClues, ...worldClues]) {
        if (!merged.has(clue.order)) {
            merged.set(clue.order, clue)
        }
    }
    if (merged.size > 0) {
        return [...merged.values()].sort((left, right) => left.order - right.order).slice(0, SETTING_CLUE_LIMIT)
    }
    const heads = parseHeads(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.heads)))
    return heads.slice(0, SETTING_CLUE_LIMIT).map((row) => ({ order: row.order, title: row.title, words: '代表章节' }))
}

/**
 * 解析设定草案：键值行按字段映射，题材沿用标签切分口径。
 * 关键约束：没有任何实质字段时返回 null，视为「产物不可用」，调用方据此重新生成；
 * 判定「有没有内容」必须把世界观、地理与核心概念算进去——只认金手指的老判定会把
 * 一份只答出世界构建的产物误当成空结果。线索始终取自本地素材，避免模型转述走样。
 */
function parseSettingDraft(text: string, clues: GoldenClue[]): PressExtractedSetting | null {
    const values = readDashedValues(text)
    const read = (key: string): string => values.get(key) ?? ''
    const setting: PressExtractedSetting = {
        logline: read('一句话简介'),
        conflict: read('核心冲突'),
        worldview: read('世界观总述'),
        geography: read('地理'),
        era: read('时代'),
        factions: read('势力'),
        powerSystem: read('力量体系'),
        concepts: read('核心概念'),
        taboo: read('禁忌'),
        goldenFingerType: read('金手指类型'),
        goldenFingerAbility: read('金手指能力'),
        goldenFingerCost: read('金手指代价'),
        perspective: read('视角'),
        tone: read('语调'),
        genres: toTraitLabels(read('题材')),
        clues: clues.map((clue) => `第 ${String(clue.order)} 章 ${clue.title}：${clue.words}`),
    }
    const hasContent =
        setting.logline.length > 0 ||
        setting.worldview.length > 0 ||
        setting.geography.length > 0 ||
        setting.era.length > 0 ||
        setting.factions.length > 0 ||
        setting.powerSystem.length > 0 ||
        setting.concepts.length > 0 ||
        setting.goldenFingerType.length > 0
    return hasContent ? setting : null
}

/** 摘要序列化：首行表头，其余按序号升序 */
function serializeSummaries(rows: SummaryRow[]): string {
    const lines = [SUMMARIES_HEADER]
    const sorted = [...rows].sort((left, right) => left.order - right.order)
    for (const row of sorted) {
        const summary = row.summary.replace(/[\t\r\n]+/gu, ' ').trim()
        lines.push(
            [String(row.order), summary, row.hook, String(row.tension), row.beats.join('；'), row.cast.join('、')].join(
                '\t',
            ),
        )
    }
    return `${lines.join('\n')}\n`
}

/** 构建摘要提示词：素材给三段原位摘录，输出带关键节点与出场人物 */
function buildSummaryMessages(rows: HeadRow[]): AiChatMessage[] {
    const blocks = rows.map((row) => {
        const tail = row.tail.length > 0 ? row.tail : '（本章较短，末段与首段重合）'
        const middle = row.middle.length > 0 ? row.middle : '（本章较短，中段与首尾重合）'
        return `### ${String(row.order)} ${row.title}\n首段：${row.head}\n中段：${middle}\n末段：${tail}`
    })
    return [
        {
            role: 'system',
            content: '你是小说编辑，只输出制表符分隔的纯文本，不做解释、不加 Markdown 代码块。',
        },
        {
            role: 'user',
            content: [
                '下面给出若干章节的标题与首段、中段、末段摘录，请为每一章写一条完整的章节记录。',
                '',
                '要求：',
                '1. 梗概不超过 120 字，按时间顺序写清「谁做了什么、结果如何」，覆盖本章主要事件，不评价、不剧透后文。',
                '2. 判断章末钩子：悬念 / 反转 / 情绪 / 无，四选一。',
                '3. 张力取 1 到 5 的整数，5 表示冲突最激烈。',
                '4. 关键节点：本章的转折或关键推进，2 到 4 条，每条不超过 20 字，用分号（；）分隔。',
                '5. 出场人物：本章有台词或明确行动的人物名，用顿号分隔，最多 6 个，只写名字不写身份。',
                '6. 严格每行六列，用制表符分隔：序号、梗概、钩子、张力、关键节点、出场。',
                '7. 不要表头，不要额外说明，不要代码块围栏。',
                '8. 给出的每一个序号都必须有一行输出。',
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
            beats: splitLabels(columns[4] ?? '', SUMMARY_BEAT_LIMIT),
            cast: splitLabels(columns[5] ?? '', SUMMARY_CAST_LIMIT),
        })
    }
    return { rows, dropped }
}

/** 构建卷纲提示词：输入是逐章摘要（含关键节点），要求输出固定字段的 Markdown 片段 */
function buildVolumeMessages(
    groupLabel: string,
    rangeText: string,
    rows: { title: string; summary: string; beats: string[] }[],
): AiChatMessage[] {
    const lines = rows.map((row, index) => {
        const beats = row.beats.length > 0 ? `（关键节点：${row.beats.join('；')}）` : ''
        return `${String(index + 1)}. ${row.title}：${row.summary}${beats}`
    })
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
                '- 情节脉络：本段主线如何推进，2 到 4 句，写清起因、升级与收束',
                '- 关键转折：本段最重要的转折，2 到 4 条，用分号分隔',
                '- 主要事件：三条，用分号分隔',
                '- 卷末钩子：一句话',
                '',
                '要求：',
                '1. 只依据给出的摘要与关键节点，不要引入摘要里没有的人物或事件。',
                '2. 情节脉络要能串起逐章顺序，关键转折必须是本段剧情走向真正改变的地方。',
                '3. 摘要信息不足以支撑某一字段时，该字段留空，不要编造。',
                '4. 不要输出标题层级之外的分隔线或总结。',
                '',
                '逐章摘要：',
                lines.join('\n'),
            ].join('\n'),
        },
    ]
}

/**
 * 构建角色卡提示词：输入是候选角色的出场统计、相关章节摘要与出场原文摘录。
 * 关键约束：年龄、外貌、口头禅只能来自原文摘录，摘要里通常没有这些细节；
 * 不给原文就等于让模型凭角色名编排，这是此前人物卡大面积空字段与过度概括的直接原因。
 */
function buildCharacterMessages(
    items: { candidate: CandidateRow; references: string[]; evidence: string[] }[],
): AiChatMessage[] {
    const blocks = items.map(({ candidate, references, evidence }) => {
        const referenceText =
            references.length > 0 ? references.map((item) => `- ${item}`).join('\n') : '- （缺少可用摘要）'
        const evidenceText = evidence.length > 0 ? evidence.map((item) => `- ${item}`).join('\n') : '- （缺少原文摘录）'
        return [
            `角色：${candidate.name}`,
            `出场次数：${String(candidate.count)}`,
            `首次出现：第 ${String(candidate.firstOrder)} 章；末次出现：第 ${String(candidate.lastOrder)} 章`,
            `高频共现：${candidate.partners.length > 0 ? candidate.partners.join('、') : '无'}`,
            '相关章节摘要：',
            referenceText,
            '出场原文摘录：',
            evidenceText,
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
                '下面给出若干角色的出场统计、相关章节摘要与出场原文摘录，请为每个角色写一张完整的人物卡。',
                '',
                '输出格式（每个角色一段，字段名严格照抄，每字段一行）：',
                '## 角色名',
                '- 姓名：角色名',
                '- 别名：道号、绰号或常用称呼，没有就留空',
                '- 分类：主角 / 配角 / 反派 / 中立 / 龙套 之一',
                '- 性别：男 / 女 / 未知',
                '- 年龄：原文写明的岁数或可直接判断的阶段（如「约二十」），没有依据就留空',
                '- 身高：原文写明的身高或可直接判断的高矮（如「一米七八」），没有依据就留空',
                '- 体型：娇小 / 清瘦 / 纤细 / 修长 / 匀称 / 健壮 / 魁梧 / 圆润 / 丰腴 / 肥胖 之一，没有依据就留空',
                '- 身份：门派、职位、出身等身份标签',
                '- 外貌：体态、五官、衣着与标志性特征的白描，只写原文出现过的',
                '- 特质：性格特征，用顿号分隔，3 到 6 个',
                '- 背景：出身、关键经历与性格成因，2 到 3 句，只写原文交代过的',
                '- 欲望：核心诉求',
                '- 弱点：',
                '- 口头禅：有原文台词依据才写，没有就留空',
                '- 能力：能力、资源或特长',
                '- 弧线：人物的变化轨迹，从什么状态走到什么状态',
                '- 关系：按「角色名（关系）：一句话说明」书写，多条用分号分隔，只写素材里出现过的人物',
                '',
                '要求：',
                '1. 候选名来自分词统计，可能根本不是人名（例如「时候」「东西」「能量」「闻言」「解释」这类普通词）。',
                '   只有能在原文摘录或摘要里确认它指代某个具体人物时，才输出该角色；无法确认的一个都不要输出。',
                '2. 只依据给出的摘要、原文摘录与统计，不要引入素材里没有的情节或外貌描写。',
                '3. 年龄、身高、体型、外貌、背景、口头禅这几项以原文摘录为准，原文没写就留空，不要猜测、不要编造。',
                '4. 关系必须写清对方是谁、是什么关系，不要只写「与主角关系密切」这类空话。',
                '5. 不要写「原文无对应人物」这类说明性条目——判断不是人物就直接不输出，不要为它占一段。',
                '6. 不要输出总述、总结或角色之外的文字。',
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
     * 校验 AI 通道与单任务锁：供阶段性任务的「快速失败」使用，避免长任务中才发现不可用。
     * 关键约束：只做检查、不占锁，真正启动时 start 会再校验一次。
     */
    public async assertReady(): Promise<void> {
        if (this.controller !== null) {
            throw new SemanticError('internal', '已有归纳任务在进行中，请等待完成或取消')
        }
        const ready = await this.provider.checkReady()
        if (!ready.ready) {
            throw new SemanticError('not-ready', ready.reason ?? 'AI 通道未就绪，请先登录或检查配置')
        }
    }

    /**
     * 启动语义归纳：按给定阶段顺序执行，已完成阶段直接跳过。
     * @param jobId 由调用方生成并立即回传前端，用于过滤进度与取消
     * @param dirPath 作品目录，形如 press/{作品名}
     * @param stages 本次要跑的阶段，缺省为「摘要 → 卷纲 → 角色卡」全部
     */
    public async start(
        jobId: string,
        dirPath: string,
        onProgress: (progress: PressSemanticProgress) => void,
        stages: readonly PressSemanticStage[] = STAGE_ORDER,
    ): Promise<SemanticOutcome> {
        if (this.controller !== null) {
            throw new SemanticError('internal', '已有归纳任务在进行中，请等待完成或取消')
        }
        const ready = await this.provider.checkReady()
        if (!ready.ready) {
            throw new SemanticError('not-ready', ready.reason ?? 'AI 通道未就绪，请先登录或检查配置')
        }
        // 旧作品的素材仍在 _import 下：先迁移再读，否则会被当成「没有素材」直接报错
        await migrateLegacyMaterialDirectory(dirPath)
        const headsUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.heads)
        const heads = parseHeads(await readTextFile(headsUri))
        if (heads.length === 0) {
            throw new SemanticError('no-material', '未找到章节素材，请先重新执行导入或素材抽取')
        }
        const controller = new AbortController()
        this.controller = controller
        this.activeJobId = jobId
        let stage: PressSemanticStage = stages[0] ?? 'summary'
        let done = 0
        let total = heads.length
        let generated = 0
        const emit = (
            status: PressSemanticProgress['status'],
            message: string,
            code?: PressSemanticErrorCode,
        ): void => {
            onProgress({
                jobId,
                stage,
                status,
                done,
                total,
                generated,
                dirPath,
                ...(code === undefined ? {} : { code }),
                message,
            })
        }
        try {
            const results: StageResult[] = []
            for (const current of stages) {
                if (controller.signal.aborted) {
                    logger.info(`语义归纳已取消：${dirPath}，停在 ${STAGE_LABELS[current]}`)
                    const message = `已取消，已完成 ${String(results.length)} 个阶段`
                    emit('cancelled', message)
                    return { status: 'cancelled', done, total, generated, dirPath, message }
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
            emit('completed', this.buildSummaryMessage(results, stages))
            return {
                status: 'completed',
                done,
                total,
                generated,
                dirPath,
                message: this.buildSummaryMessage(results, stages),
            }
        } catch (error) {
            if (error instanceof SemanticError) {
                // 配额用尽属于「暂停」而非「出错」：保留已完成进度，用户调大限额或次日续跑
                if (error.code === 'quota-exceeded') {
                    logger.info(`语义归纳暂停：${dirPath}，已完成 ${String(done)}/${String(total)}`)
                    emit('failed', error.message, 'quota-exceeded')
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
            const isAborted = controller.signal.aborted
            const summary = isAborted ? '已取消' : `语义归纳中断：${message}`
            emit(isAborted ? 'cancelled' : 'failed', summary, isAborted ? 'aborted' : 'internal')
            return {
                status: isAborted ? 'cancelled' : 'failed',
                done,
                total,
                generated,
                dirPath,
                code: isAborted ? 'aborted' : 'internal',
                message: summary,
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
        // 先迁移旧目录：产物在 _import 里时不能被判成「没有角色卡」而重跑耗配额
        await migrateLegacyMaterialDirectory(dirPath)
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
            // 素材由导入流程产出，失败只记日志；这里补抽一次本地统计，用户不必为「素材缺失」另找入口。
            // 出场原文是本次升级新增的素材：旧作品只有候选表，缺证据文件时同样要补抽，否则人物卡只能读摘要。
            const candidatesUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.candidates)
            const evidenceUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.evidence)
            const isMaterialMissing =
                (await readTextFile(candidatesUri)).trim().length === 0 ||
                (await readTextFile(evidenceUri)).trim().length === 0
            if (isMaterialMissing) {
                emit('running', '正在抽取章节素材…', 0, 0)
                try {
                    await analyzeProject(dirPath)
                } catch (error) {
                    logger.error(`素材抽取失败：${dirPath}`, error)
                }
            }
            const result = await this.runCharacters(dirPath, controller.signal, (state) => {
                emit('running', state.message, state.done, state.total)
            })
            const characters = parseCharacterDrafts(
                await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${CHARACTERS_FILE}`),
            )
            // 没有候选时区分「正文是乱码」与「确实没有人名」：前者只能重新导入，重试多少次都一样
            const isGarbled =
                characters.length === 0 &&
                looksGarbled(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.heads)))
            const message = buildExtractMessage(result, characters.length, isGarbled)
            emit('completed', message, result.done, result.total)
            return { characters, message }
        } finally {
            this.controller = null
            this.activeJobId = ''
        }
    }

    /**
     * 用已落盘的导入素材重建大纲树：卷名与章序取自章节清单，梗概、钩子、关键节点与出场人物取自章节摘要，
     * 卷目标、冲突、情节脉络与关键转折取自 AI 卷纲产物（尚未生成时留空）。
     * 关键约束：素材缺失时先补跑本地抽取；本方法不调用模型，摘要或卷纲缺失只让对应字段为空，
     * 章节仍照常返回，保证未做 AI 归纳时「提取大纲」同样可用。
     */
    public async extractOutline(dirPath: string): Promise<{ volumes: PressExtractedVolume[]; message: string }> {
        await migrateLegacyMaterialDirectory(dirPath)
        const indexUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.index)
        if ((await readTextFile(indexUri)).trim().length === 0) {
            await analyzeProject(dirPath)
        }
        const indexRows = parseIndex(await readTextFile(indexUri))
        if (indexRows.length === 0) {
            return { volumes: [], message: '没有扫描到章节：请确认作品目录下存在章节文档' }
        }
        const summaries = new Map(
            parseSummaries(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries))).map(
                (row) => [row.order, row],
            ),
        )
        const volumeMeta = new Map(
            splitLevelSections(
                await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${VOLUMES_FILE}`),
                3,
            ).map((section) => {
                const values = readDashedValues(section.content)
                return [
                    section.title,
                    {
                        goal: values.get('卷目标') ?? '',
                        conflict: values.get('卷冲突') ?? '',
                        plotline: values.get('情节脉络') ?? '',
                        turningPoints: splitLabels(values.get('关键转折') ?? '', SUMMARY_BEAT_LIMIT),
                    },
                ] as const
            }),
        )
        const groups = new Map<string, PressExtractedChapter[]>()
        for (const row of indexRows) {
            const summary = summaries.get(row.order)
            const chapter: PressExtractedChapter = {
                order: row.order,
                title: row.title,
                summary: summary?.summary ?? '',
                hook: summary?.hook ?? '无',
                tension: summary?.tension ?? 3,
                wordCount: row.charCount,
                // 关键节点与出场人物直接来自章节摘要：节拍是「已经发生的情节」，不是待写的计划
                beats: summary?.beats ?? [],
                characters: summary?.cast ?? [],
            }
            const bucket = groups.get(row.volumeDir)
            if (bucket === undefined) {
                groups.set(row.volumeDir, [chapter])
            } else {
                bucket.push(chapter)
            }
        }
        const volumes: PressExtractedVolume[] = []
        for (const [volumeDir, chapters] of groups) {
            const meta = volumeMeta.get(volumeDir)
            volumes.push({
                name: volumeDir.length > 0 ? volumeDir : '未分卷',
                goal: meta?.goal ?? '',
                conflict: meta?.conflict ?? '',
                plotline: meta?.plotline ?? '',
                turningPoints: meta?.turningPoints ?? [],
                chapters,
            })
        }
        const message =
            summaries.size === 0
                ? `已按素材重建 ${String(volumes.length)} 卷 ${String(indexRows.length)} 章（尚无章节摘要，梗概待补）`
                : `已按素材重建 ${String(volumes.length)} 卷 ${String(indexRows.length)} 章`
        return { volumes, message }
    }

    /**
     * 提取作品设定：读金手指候选章与世界构建候选章的三段摘录与章节摘要，让模型归纳设定字段。
     * 关键约束：产物已存在时直接复用，重复提取不消耗配额；与其它归纳共用单任务锁与每日配额；
     * 线索由本地素材带出、不依赖模型输出，便于用户对照核实。
     */
    public async extractSetting(dirPath: string): Promise<{ setting: PressExtractedSetting | null; message: string }> {
        await migrateLegacyMaterialDirectory(dirPath)
        const goldenUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.goldenFinger)
        const worldUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.worldClues)
        const isMaterialMissing =
            (await readTextFile(goldenUri)).trim().length === 0 && (await readTextFile(worldUri)).trim().length === 0
        if (isMaterialMissing) {
            await analyzeProject(dirPath)
        }
        const clues = await resolveSettingClues(
            dirPath,
            parseGoldenClues(await readTextFile(goldenUri)),
            parseGoldenClues(await readTextFile(worldUri)),
        )
        const cachedContent = await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${SETTING_FILE}`)
        // 旧版设定产物没有世界观总述：视为未完成，交给 runSetting 重跑一次再返回
        const cached = isProductUpToDate(cachedContent, ['- 世界观总述：'])
            ? parseSettingDraft(cachedContent, clues)
            : null
        if (cached !== null) {
            return { setting: cached, message: '已复用既有设定草案' }
        }
        if (clues.length === 0) {
            return { setting: null, message: '作品里没有可用章节：请先完成导入或素材抽取' }
        }
        if (this.controller !== null) {
            throw new SemanticError('internal', '已有归纳任务在进行中，请等待完成或取消')
        }
        const ready = await this.provider.checkReady()
        if (!ready.ready) {
            throw new SemanticError('not-ready', ready.reason ?? 'AI 通道未就绪，请先登录或检查配置')
        }
        this.assertQuota()
        const controller = new AbortController()
        this.controller = controller
        try {
            await this.runSetting(dirPath, controller.signal, () => {
                // 单次提取不需要细粒度进度，前端只用返回结果
            })
            const setting = parseSettingDraft(
                await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${SETTING_FILE}`),
                clues,
            )
            if (setting === null) {
                return { setting: null, message: '模型没有返回可用的设定字段，请重试' }
            }
            logger.info(`设定提取完成：${dirPath}`)
            return { setting, message: `已提取设定与 ${String(clues.length)} 章线索供核对` }
        } finally {
            this.controller = null
        }
    }

    /**
     * 构建设定提取提示词：候选章的三段摘录、章节摘要与命中词一次给全。
     * 关键约束：世界构建、规则体系与核心概念各有专属字段，不能只让模型写一句「时代」了事。
     */
    private async buildSettingMessages(dirPath: string, clues: GoldenClue[]): Promise<AiChatMessage[]> {
        const heads = new Map(
            parseHeads(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.heads))).map((row) => [
                row.order,
                row,
            ]),
        )
        const summaries = new Map(
            parseSummaries(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries))).map(
                (row) => [row.order, row],
            ),
        )
        const blocks = clues.slice(0, SETTING_CLUE_LIMIT).map((clue) => {
            const head = heads.get(clue.order)
            const summary = summaries.get(clue.order)
            const excerpt =
                head === undefined
                    ? ''
                    : `首段：${head.head}\n中段：${head.middle.length > 0 ? head.middle : '（本章较短，中段与首尾重合）'}\n末段：${head.tail}`
            const preview =
                summary === undefined
                    ? ''
                    : `梗概：${summary.summary}\n关键节点：${summary.beats.length > 0 ? summary.beats.join('；') : '（未归纳）'}\n`
            return `### 第 ${String(clue.order)} 章 ${clue.title}\n命中词：${clue.words}\n${preview}${excerpt}`
        })
        return [
            {
                role: 'system',
                content:
                    '你是资深小说策划。只输出「- 键：值」形式的纯文本，每行一个字段，不做解释、不加 Markdown 代码块。信息不足的字段留空，不要编造。',
            },
            {
                role: 'user',
                content: [
                    '下面是一部长篇作品的「设定候选章」素材：命中世界构建或金手指关键词的章节、该章梗概、关键节点与三段摘录。',
                    '请据此归纳作品的世界观与写作设定，严格按以下键名逐行输出：',
                    '- 一句话简介：全书主线的一句话概括',
                    '- 核心冲突：贯穿全书的主要对抗',
                    '- 世界观总述：世界的形态、历史沿革、种族与文明结构，3 到 5 句',
                    '- 地理：主要地域、场景与空间格局，2 到 4 句',
                    '- 时代：时代背景或社会发展阶段，一句话',
                    '- 势力：主要组织与它们之间的关系，用顿号分隔，可注明立场',
                    '- 力量体系：等级、进阶路径与运作规则，写清「怎么变强、上限在哪」',
                    '- 核心概念：作品独有的名词与设定（如灵气、序列、异火），每个词后跟一句解释，用分号分隔',
                    '- 禁忌：世界规则中的禁区或代价',
                    '- 金手指类型：',
                    '- 金手指能力：',
                    '- 金手指代价：',
                    '- 视角：第一人称 / 第三人称限知 / 第三人称全知，三选一',
                    '- 语调：用一个词概括（如轻松、热血、压抑）',
                    '- 题材：用顿号分隔 1-3 个标签',
                    '只依据素材推断，素材没体现的就留空：宁缺毋滥，编造的设定会直接污染后续写作。',
                    '',
                    ...blocks,
                ].join('\n'),
            },
        ]
    }

    /**
     * 阶段四：归纳作品设定，写出 setting.md。
     * 关键约束：产物已存在即跳过，重复跑不消耗配额；模型未给出任何可用字段时不落盘，
     * 留待用户重试，避免用空文件把阶段标记成「已完成」。
     */
    private async runSetting(
        dirPath: string,
        signal: AbortSignal,
        onState: (state: { done: number; total: number; message: string }) => void,
    ): Promise<StageResult> {
        const settingUri = resolveMaterialFile(dirPath, `${PRESS_IMPORT_DIR}/${SETTING_FILE}`)
        await vscode.workspace.fs.createDirectory(resolveMaterialFile(dirPath, PRESS_IMPORT_DIR))
        const cachedContent = await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${SETTING_FILE}`)
        if (isProductUpToDate(cachedContent, ['- 世界观总述：'])) {
            onState({ done: 0, total: 0, message: '设定草案已存在，跳过' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        const clues = await resolveSettingClues(
            dirPath,
            parseGoldenClues(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.goldenFinger))),
            parseGoldenClues(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.worldClues))),
        )
        if (clues.length === 0) {
            onState({ done: 0, total: 0, message: '缺少可用章节，跳过设定' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        if (signal.aborted) {
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        this.assertQuota()
        const messages = await this.buildSettingMessages(dirPath, clues)
        const content = await this.generate(messages, signal)
        if (parseSettingDraft(content, clues) === null) {
            onState({ done: 0, total: 0, message: '模型没有返回可用的设定字段' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        await writeTextFile(settingUri, `${content.trim()}\n`)
        consumeToday(this.db, QUOTA_KEYS)
        onState({ done: 1, total: 1, message: `设定草案已生成（取材 ${String(clues.length)} 章）` })
        return { generated: 1, done: 1, total: 1, skipped: false }
    }

    /** 取消进行中的归纳：在下一个批次边界生效 */
    public cancel(jobId: string): { cancelled: boolean } {
        if (this.controller === null || this.activeJobId !== jobId) {
            return { cancelled: false }
        }
        this.controller.abort()
        return { cancelled: true }
    }

    /**
     * 阶段汇总文案：只列出本轮真正生成内容的阶段。
     * 关键约束：results 与 stages 一一对应，不能按 STAGE_ORDER 取下标——
     * 只跑部分阶段时下标会错位，把角色卡的结果说成章节摘要。
     */
    private buildSummaryMessage(results: readonly StageResult[], stages: readonly PressSemanticStage[]): string {
        const generatedParts: string[] = []
        for (const [index, result] of results.entries()) {
            const stage = stages[index]
            if (stage === undefined || result.skipped || result.generated === 0) {
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
        if (stage === 'setting') {
            return this.runSetting(dirPath, signal, onState)
        }
        return this.runCharacters(dirPath, signal, onState)
    }

    /**
     * 阶段一：逐批生成章节摘要，写入 summaries.tsv。
     * 关键约束：待处理的范围除「还没有摘要的章」外，还包括「有摘要但缺关键节点」的章——
     * 旧版摘要只有四列，不补跑的话升级后的大纲永远拿不到节拍与出场人物。
     * 结果按序号覆盖合并，重跑同一章不会在文件里留下两行。
     */
    private async runSummary(
        dirPath: string,
        heads: HeadRow[],
        signal: AbortSignal,
        onState: (state: { done: number; total: number; message: string }) => void,
    ): Promise<StageResult> {
        const summariesUri = resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries)
        const existingByOrder = new Map(
            parseSummaries(await readTextFile(summariesUri)).map((row) => [row.order, row] as const),
        )
        const pending = heads.filter((row) => {
            const existing = existingByOrder.get(row.order)
            return existing === undefined || existing.beats.length === 0
        })
        const total = heads.length
        const baseDone = total - pending.length
        let done = baseDone
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
            for (const row of parsed.rows) {
                existingByOrder.set(row.order, row)
            }
            await writeTextFile(summariesUri, serializeSummaries([...existingByOrder.values()]))
            consumeToday(this.db, QUOTA_KEYS)
            generated += parsed.rows.length
            done = Math.min(total, baseDone + generated)
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
        const existing = await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${VOLUMES_FILE}`)
        if (isProductUpToDate(existing, ['- 情节脉络：'])) {
            onState({ done: 0, total: 0, message: '卷纲已存在，跳过' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        const indexRows = parseIndex(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.index)))
        const summaries = new Map(
            parseSummaries(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.summaries))).map(
                (row) => [row.order, row] as const,
            ),
        )
        if (indexRows.length === 0 || summaries.size === 0) {
            onState({ done: 0, total: 0, message: '缺少章节清单或摘要，跳过卷纲' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        // 按卷分组；未分卷的章节落到同一组，超长时再按固定章数切段
        const groups = new Map<string, { order: number; title: string; summary: string; beats: string[] }[]>()
        for (const row of indexRows) {
            const summary = summaries.get(row.order)
            if (summary === undefined || summary.summary.length === 0) {
                continue
            }
            const label = row.volumeDir.length > 0 ? row.volumeDir : '未分卷'
            const bucket = groups.get(label) ?? []
            bucket.push({ order: row.order, title: row.title, summary: summary.summary, beats: summary.beats })
            groups.set(label, bucket)
        }
        const sections: string[] = [
            '# 卷纲',
            '',
            '> 由 AI 依据逐章摘要与关键节点归纳，未经原著核对。信息不足的字段留空。',
            '',
        ]
        const tasks: { label: string; range: string; rows: { title: string; summary: string; beats: string[] }[] }[] =
            []
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
        const existing = await readMaterialText(dirPath, `${PRESS_IMPORT_DIR}/${CHARACTERS_FILE}`)
        // 键名齐备还不够：旧产物可能全是「时候」「东西」这类噪声条目，过滤后一条不剩时必须重跑；
        // 身高与体型是后加的字段，旧产物里没有它们就永远补不进已有的人物卡，故一并纳入齐备判定，触发一次重跑
        const isUpToDate =
            isProductUpToDate(existing, ['- 外貌：', '- 背景：', '- 身高：', '- 体型：']) &&
            parseCharacterDrafts(existing).length > 0
        if (isUpToDate) {
            onState({ done: 0, total: 0, message: '角色卡已存在，跳过' })
            return { generated: 0, done: 0, total: 0, skipped: true }
        }
        // 旧素材的候选表里积着「时候」「东西」这类噪声：读入后再过一道人名过滤，
        // 否则它们会占掉 CHARACTER_LIMIT 的额度，把真正的次要角色挤出归纳范围
        const candidates = parseCandidates(
            await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.candidates)),
        )
            .filter((candidate) => isLikelyPersonName(candidate.name))
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
        // 出场原文是年龄、外貌、口头禅的唯一可靠来源：摘要里通常没有这些细节
        const evidence = parseEvidence(await readTextFile(resolveMaterialFile(dirPath, MATERIAL_FILE_NAMES.evidence)))
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
        /** 取角色的出场原文摘录：统计行不含原文，单独截断后一并给模型当戏份依据 */
        const collectCharacterEvidence = (candidate: CandidateRow): string[] => {
            const lines = evidence.get(candidate.name) ?? []
            const stat = lines.find((line) => line.startsWith('统计：'))
            const excerpts = lines.filter((line) => line.startsWith('第 ')).slice(0, CHARACTER_EVIDENCE_LIMIT)
            return [...(stat === undefined ? [] : [stat]), ...excerpts]
        }
        const sections: string[] = [
            '# 角色卡',
            '',
            '> 由 AI 依据出场统计、章节摘要与出场原文生成，未经原著核对。信息不足的字段留空，请以原著为准修正。',
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
            const items = batch.map((candidate) => ({
                candidate,
                references: collectReferences(candidate),
                evidence: collectCharacterEvidence(candidate),
            }))
            const content = await this.generate(buildCharacterMessages(items), signal)
            const cleaned = filterCharacterOutput(content.replace(/^```[a-z]*$/giu, '').trim())
            if (cleaned.length > 0) {
                sections.push(cleaned, '')
                // 计数按可用卡片算：模型自造的噪声块已被清洗掉，不该算进「已生成 N 项」
                generated += parseCharacterDrafts(cleaned).length
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
