/**
 * 朱雀文本分类客户端：调用 EdgeOne Makers 的 zhuque-text 接口识别 AI 生成特征。
 * 复用约定：出网统一用 fetch + AbortSignal，凭证由服务层从 SecretStorage 取出后传入，本层不读配置也不落日志。
 * 关键约束：每次请求固定 is_merge=false（需要段落级结果），text 超长先截断；
 * 响应逐字段收窄，非 success 状态抛出平台 msg，比例做归一化，分段位置越界即丢弃；
 * 额度核算取 makers_models_usage.total_tokens（官方口径），不使用 usage.total_tokens。
 */

/** 朱雀文本分类接口地址（EdgeOne Makers 内置模型） */
const ENDPOINT = 'https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify'

/** 请求超时：平台单次分类通常 2–5 秒，留足余量 */
const TIMEOUT_MS = 25_000

/** 单次提交文本上限：接口文档未给上限，按本地校对上限再兜一层 */
const MAX_TEXT_LENGTH = 50_000

/** 平台未给错误信息时的兜底文案 */
const DEFAULT_ERROR = '朱雀检测返回异常，请稍后重试'

/** 分段标签：0 人工、1 AI、2 疑似 AI */
export type ZhuqueLabel = 0 | 1 | 2

/** 平台返回的分段结果 */
export interface ZhuqueSegment {
    label: ZhuqueLabel
    conf: number
    /** 平台分段序号（1 基，缺失为 0） */
    order: number
    /** 分段在提交文本中的区间 */
    start: number
    end: number
    text: string
}

/** 收窄后的分类结果：比例已归一化 */
export interface ZhuqueClassifyResult {
    humanRatio: number
    aiRatio: number
    suspectRatio: number
    confidence: number
    ratioConfidence: number
    segments: ZhuqueSegment[]
    usedTokens: number
}

/** 读取概率值：非数值与负数归零，超过 1 夹到 1 */
function readProbability(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0
    }
    return Math.min(value, 1)
}

/**
 * 读取占比原始值：只做有限正数校验，不做上界夹取。
 * 关键约束：平台存在按百分数（0–100）返回的情况，先夹到 1 会把 48.01 / 25.68 / 26.31 全部抹平成 1，
 * 归一化后变成均分；因此这里保留原值，由调用方按总和归一化统一口径。
 */
function readPositive(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0
    }
    return value
}

/** 读取总量：只接受正整数 */
function readTokens(value: unknown): number {
    if (typeof value !== 'object' || value === null) {
        return 0
    }
    const total = (value as { total_tokens?: unknown }).total_tokens
    return typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
}

/** 读取三类占比并归一化：全 0 时保持 0，避免前端出现无法解释的饼图 */
function readLabelsRatio(value: unknown): { human: number; ai: number; suspect: number } {
    if (typeof value !== 'object' || value === null) {
        return { human: 0, ai: 0, suspect: 0 }
    }
    const source = value as Record<string, unknown>
    const human = readPositive(source['0'])
    const ai = readPositive(source['1'])
    const suspect = readPositive(source['2'])
    const total = human + ai + suspect
    if (total <= 0) {
        return { human: 0, ai: 0, suspect: 0 }
    }
    return { human: human / total, ai: ai / total, suspect: suspect / total }
}

/** 收窄单个分段：标签非法或位置越界即丢弃 */
function readSegment(value: unknown, textLength: number): ZhuqueSegment | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const source = value as { label?: unknown; conf?: unknown; order?: unknown; position?: unknown; text?: unknown }
    const label = source.label === 0 || source.label === 1 || source.label === 2 ? source.label : null
    const position = Array.isArray(source.position) ? source.position : []
    const start = typeof position[0] === 'number' ? position[0] : -1
    const end = typeof position[1] === 'number' ? position[1] : -1
    if (label === null || !Number.isInteger(start) || !Number.isInteger(end)) {
        return null
    }
    if (start < 0 || end <= start || end > textLength) {
        return null
    }
    const conf = readProbability(source.conf)
    const order =
        typeof source.order === 'number' && Number.isInteger(source.order) && source.order > 0 ? source.order : 0
    const text = typeof source.text === 'string' ? source.text.slice(0, 200) : ''
    return { label, conf, order, start, end, text }
}

/**
 * 把平台响应收窄成插件内部结构。
 * 关键约束：这是检测结果唯一的合法性关口——外部字段一律不可信，越界位置必须丢弃而不是夹取，
 * 否则会把分段标到错误的正文位置。
 */
export function mapZhuqueResponse(payload: unknown, textLength: number): ZhuqueClassifyResult {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(DEFAULT_ERROR)
    }
    const source = payload as {
        status?: unknown
        msg?: unknown
        softmax_confidence?: unknown
        ratio_confidence?: unknown
        labels_ratio?: unknown
        segment_labels?: unknown
        makers_models_usage?: unknown
    }
    if (source.status !== 'success') {
        const message =
            typeof source.msg === 'string' && source.msg.trim().length > 0 ? source.msg.trim() : DEFAULT_ERROR
        throw new Error(`朱雀检测失败：${message}`)
    }
    const ratios = readLabelsRatio(source.labels_ratio)
    const segments: ZhuqueSegment[] = []
    if (Array.isArray(source.segment_labels)) {
        for (const item of source.segment_labels) {
            const segment = readSegment(item, textLength)
            if (segment !== null) {
                segments.push(segment)
            }
        }
    }
    return {
        humanRatio: ratios.human,
        aiRatio: ratios.ai,
        suspectRatio: ratios.suspect,
        confidence: readProbability(source.softmax_confidence),
        ratioConfidence: readProbability(source.ratio_confidence),
        segments,
        usedTokens: readTokens(source.makers_models_usage),
    }
}

/** 提交一次文本分类：网络异常统一转成可读提示，不透传底层错误细节 */
export async function classifyWithZhuque(
    text: string,
    apiKey: string,
    signal?: AbortSignal,
): Promise<ZhuqueClassifyResult> {
    const body = text.slice(0, MAX_TEXT_LENGTH)
    if (body.trim().length === 0) {
        throw new Error('正文为空，没有可检测的内容')
    }
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
        response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: body, is_merge: false }),
            signal: combined,
        })
    } catch (error) {
        if (signal?.aborted === true) {
            throw new Error('AI 特征检测已取消', { cause: error })
        }
        throw new Error('朱雀检测请求失败，请检查网络后重试', { cause: error })
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const suffix = detail.trim().length > 0 ? ` ${detail.trim().slice(0, 120)}` : ''
        throw new Error(`朱雀检测失败：HTTP ${String(response.status)}${suffix}`)
    }
    const parsed: unknown = await response.json()
    return mapZhuqueResponse(parsed, body.length)
}
