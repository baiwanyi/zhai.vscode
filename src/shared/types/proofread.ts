/**
 * 校对契约：写作管理页「校对」分区的检查目标、问题条目、词库与写回请求结构。
 * 使用方：Webview 校对页（src/workflow/proofread/）与宿主 ProofreadRoutes / ProofreadService。
 * 复用约定：偏移一律以 target.text 为基准（UTF-16 字符下标），定位到编辑器时由宿主叠加 offsetBase；
 * 类别、严重度与来源在这里收敛成字面量联合，前端配色与宿主规则共用同一份取值。
 * 关键约束：replacement 仅有确定性替换（错别字、标点、自定义词库）才非空，语义类问题只提示不替换；
 * 前端传入的路径与区间不可信，宿主须回查文档与长度后才可写盘或定位。
 */

/** 检查类别：错别字、病句、风险段落、自定义纠错 */
export type ProofreadCategory = 'typo' | 'sentence' | 'risk' | 'custom'

/** 类别取值清单：顺序即界面检查卡的展示顺序 */
export const PROOFREAD_CATEGORIES: readonly ProofreadCategory[] = ['typo', 'sentence', 'risk', 'custom']

/** 严重度：low 可一键写回，medium 仅提示，high 需人工确认段落 */
export type ProofreadSeverity = 'low' | 'medium' | 'high'

/** 结果来源：本地规则或 AI 语义检查 */
export type ProofreadSource = 'local' | 'ai'

/** 单条问题：位置以 target.text 为基准，展示与定位共用 */
export interface ProofreadIssue {
    /** 稳定标识：由类别与偏移拼成，前端据此做忽略与选中 */
    id: string
    category: ProofreadCategory
    severity: ProofreadSeverity
    /** 原文片段：用于列表展示与宿主写回前回查 */
    quote: string
    start: number
    end: number
    /** 建议替换文本：仅 low 且确定性替换时非空 */
    replacement: string | null
    /** 判定理由 */
    reason: string
    source: ProofreadSource
    /** 段落序号（1 基）：列表分组与「按段落定位」共用 */
    paragraph: number
}

/** 检查目标类型：整篇文档或编辑器选区 */
export type ProofreadTargetKind = 'document' | 'selection'

/** 检查目标：正文与在文档中的位置由宿主读取，前端不访问文件系统 */
export interface ProofreadTarget {
    kind: ProofreadTargetKind
    /** 相对存储根路径，形如 press/剑来/Chapters/01-初见.md */
    path: string
    /** 展示标题：文档文件名去扩展名 */
    title: string
    /** 待检查正文：整篇时已剔除 Frontmatter，选区时为选中文本 */
    text: string
    /** 正文的字符数（不含空白） */
    wordCount: number
    /** 正文在文档全文中的起始字符偏移：编辑器偏移 = offsetBase + issue.start */
    offsetBase: number
    /** 文档版本号：编辑器每次改动自增，用于判断 AI 结果与当前正文是否错位 */
    version: number
    /**
     * 缓存签名：已保存文档为磁盘修改时间（ISO 8601），脏文档为正文摘要（digest:…）。
     * 关键约束：同一份正文每次读取必须得到同一值，脏文档不得填当前时间，否则缓存永远判不中。
     */
    mtime: string
    /** 是否因超长被截断（截断后只检查前 maxChars 个字符） */
    truncated: boolean
}

/** 本地检查结果 */
export interface ProofreadLocalResult {
    issues: ProofreadIssue[]
    elapsedMs: number
    /** 被忽略词放过的命中数：用于「设置词库」的提示文案 */
    suppressed: number
    /** 参与本次检查的自定义词条数 */
    lexiconEntries: number
}

/** 一次本地检查的完整返回：目标与结果同批返回，避免前端两次读取产生错位 */
export interface ProofreadRunResult {
    target: ProofreadTarget
    local: ProofreadLocalResult
}

/** 写回条目：区间与替换文本均以 target.text 为基准 */
export interface ProofreadApplyEdit {
    start: number
    end: number
    /** 原文片段：宿主写回前逐条回查，对不上即跳过 */
    quote: string
    replacement: string
}

/** 批量写回请求 */
export interface ProofreadApplyRequest {
    /** 相对存储根路径，须与当前编辑器文档一致 */
    path: string
    offsetBase: number
    edits: ProofreadApplyEdit[]
}

/** 批量写回结果 */
export interface ProofreadApplyResult {
    applied: number
    skipped: number
}

/** 定位请求：文档绝对偏移，宿主换算成编辑器位置并选中 */
export interface ProofreadRevealRequest {
    path: string
    documentStart: number
    documentEnd: number
}

/** 定位结果 */
export interface ProofreadRevealResult {
    revealed: boolean
}

/** 取消 AI 检查结果：aborted 为 false 表示当时没有进行中的检查 */
export interface ProofreadAbortResult {
    aborted: boolean
}

/** 自定义词条：replace 参与一键写回，flag 仅提示 */
export interface ProofreadLexiconEntry {
    wrong: string
    right: string
    mode: 'replace' | 'flag'
    note?: string
}

/** 自定义词库：落 {存储根}/proofread/lexicon.json，用户可直接编辑 */
export interface ProofreadLexicon {
    version: 1
    entries: ProofreadLexiconEntry[]
    /** 忽略词：角色名、专有名词，命中即跳过 */
    ignores: string[]
}

/** 词库文件状态：前端据此展示「设置词库」入口的文案 */
export interface ProofreadLexiconState {
    /** 相对存储根路径，形如 proofread/lexicon.json */
    path: string
    exists: boolean
    entries: number
    ignores: number
}

/**
 * AI 检查结果：额外带回文档路径与修改时间，前端据此判断结果是否已与当前文档错位。
 * 关键约束：issues 的偏移仍以 target.text 为基准，与本地结果共用同一套定位与展示逻辑。
 */
export interface ProofreadAiResult {
    issues: ProofreadIssue[]
    path: string
    /** 检查时的文档版本号：与本地结果的 target.version 不一致即视为已过期 */
    version: number
    mtime: string
    /** 总批次数与失败批次数：失败批次不影响其余批次的结果 */
    batches: number
    failedBatches: number
    /** 整体预算耗尽而未提交的批次数：与失败区分，界面提示结果不完整 */
    skippedBatches: number
    usageTokens: number
}

/** AI 检查进度：经 state 的 proofread 通道推送，前端据此显示批次进度 */
export interface ProofreadAiProgress {
    kind: 'progress'
    /** 已完成的批次数（1 基） */
    batch: number
    total: number
}

/** 朱雀分段标签：0 人工、1 AI、2 疑似 AI */
export type ProofreadDetectLabel = 0 | 1 | 2

/** 可疑分段：位置以 target.text 为基准，与校对条目共用同一套定位逻辑 */
export interface ProofreadDetectSegment {
    /** 分段序号（1 基，优先取平台返回的 order） */
    paragraph: number
    label: ProofreadDetectLabel
    /** 该分段的置信度 */
    conf: number
    start: number
    end: number
    text: string
}

/**
 * AI 特征检测结果：比例均为 0–1，三项之和为 1（平台返回全 0 时保持 0）。
 * 关键约束：segments 只保留非人工分段并按置信度降序截断，用于「AI 味最重段落」列表；
 * 结果仅作辅助判断，不参与任何自动改写。
 */
export interface ProofreadAiDetectResult {
    path: string
    version: number
    humanRatio: number
    aiRatio: number
    suspectRatio: number
    /** 整体判定置信度（softmax_confidence） */
    confidence: number
    /** 整体疑似占比（ratio_confidence） */
    ratioConfidence: number
    segments: ProofreadDetectSegment[]
    /** 本次实际扣减额度 token（makers_models_usage.total_tokens） */
    usedTokens: number
    detectedAt: string
}

/** 检测可用状态：前端据此决定展示配置密钥、同意上传还是直接检测 */
export interface ProofreadAiDetectState {
    hasKey: boolean
    hasConsent: boolean
    /** 今日剩余次数；null 表示不限 */
    remaining: number | null
}

/**
 * 缓存里的检查目标：剔除正文本身，只保留展示与偏移换算所需字段。
 * 关键约束：chars 与 mtime 一起作为「缓存是否仍对应当前正文」的签名，正文一变缓存即失效。
 */
export interface ProofreadCachedTarget extends Omit<ProofreadTarget, 'text'> {
    /** 检查时的正文字符数（含空白），用于判断正文是否已被改动 */
    chars: number
}

/**
 * 校对结果缓存：落 globalState，供再次打开校对页时直接还原上次结果。
 * 关键约束：只有当前文档与 target 签名一致时才可复用，写回与定位仍走宿主重新回查；
 * local 始终是该正文的完整本地结果，ai 只会附加在同一份正文上（重新校对后作废为 null）。
 */
export interface ProofreadCache {
    /** 写入时间（ISO） */
    savedAt: string
    target: ProofreadCachedTarget
    local: ProofreadLocalResult
    /** AI 语义与风险段落结果：未跑或已作废时为 null */
    ai: ProofreadAiResult | null
}

/** AI 特征检测结果缓存：与校对结果分开存，正文未变时供再次打开页面直接还原 */
export interface ProofreadDetectCache {
    savedAt: string
    target: ProofreadCachedTarget
    result: ProofreadAiDetectResult
}

/** 判断是否为合法类别（前端不可信载荷收窄用） */
export function isProofreadCategory(value: unknown): value is ProofreadCategory {
    return typeof value === 'string' && (PROOFREAD_CATEGORIES as readonly string[]).includes(value)
}

/** 判断是否为合法进度载荷：前端只认整数且不得超出上限的进度 */
export function isProofreadAiProgress(value: unknown): value is ProofreadAiProgress {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const source = value as { kind?: unknown; batch?: unknown; total?: unknown }
    if (source.kind !== 'progress') {
        return false
    }
    const { batch, total } = source
    if (typeof batch !== 'number' || typeof total !== 'number') {
        return false
    }
    return Number.isInteger(batch) && Number.isInteger(total) && total > 0 && batch >= 0 && batch <= total
}
