/**
 * 校对协议路由：把 proofread/* 消息分发到 ProofreadService，并在此完成入参收窄。
 * 复用约定：由 AiChatViewProvider 统一接收 Webview 消息后按前缀委托，与 naming / press 路由同构。
 * 关键约束：路径、偏移与替换文本全部来自不可信载荷，超长或非整数一律拒绝；
 * 单次写回条数、区间长度与替换文本长度在这里先卡一道，服务层再逐条回查原文。
 */
import type {
    ProofreadApplyEdit,
    ProofreadApplyRequest,
    ProofreadLexicon,
    ProofreadLexiconEntry,
    ProofreadRevealRequest,
} from '@shared/types/proofread'
import type { ProofreadService } from './proofreadService'

/** 单次写回条数上限 */
const MAX_EDITS = 500

/** 相对路径长度上限 */
const MAX_PATH_LENGTH = 512

/** 原文片段长度上限 */
const MAX_QUOTE_LENGTH = 400

/** 替换文本长度上限 */
const MAX_REPLACEMENT_LENGTH = 200

/** 进度广播回调：由宿主注入，把 AI 分批进度推给前端 */
export type ProofreadProgressHandler = (completed: number, total: number) => void

export class ProofreadRoutes {
    public constructor(private readonly service: ProofreadService) {}

    /** 处理校对协议方法 */
    public async handle(method: string, payload: unknown, onProgress?: ProofreadProgressHandler): Promise<unknown> {
        switch (method) {
            case 'proofread/target':
                return this.service.readTarget(readUseSelection(payload))
            case 'proofread/local':
                return this.service.runLocal(readUseSelection(payload))
            case 'proofread/ai':
                return this.service.runAi(readUseSelection(payload), onProgress)
            case 'proofread/ai/abort':
                return this.service.abortAi()
            case 'proofread/aiDetect':
                return this.service.runDetect(readUseSelection(payload))
            case 'proofread/aiDetect/state':
                return this.service.getDetectState()
            case 'proofread/aiDetect/cache':
                return this.service.getCachedDetect()
            case 'proofread/aiDetect/consent':
                return this.service.setDetectConsent(readAccepted(payload))
            case 'proofread/apply':
                return this.service.apply(readApplyRequest(payload))
            case 'proofread/cache':
                return this.service.getCachedResult()
            case 'proofread/reveal':
                return this.service.reveal(readRevealRequest(payload))
            case 'proofread/lexicon':
                return this.service.getLexiconState()
            case 'proofread/lexicon/open':
                return this.service.openLexicon()
            case 'proofread/lexicon/read':
                return this.service.readLexiconContent()
            case 'proofread/lexicon/save':
                return this.service.saveLexiconContent(readLexiconPayload(payload))
            default:
                throw new Error(`未知的校对协议方法：${method}`)
        }
    }
}

/** 是否只检查选区：缺省与非法值一律按整篇处理 */
function readUseSelection(payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return (payload as { useSelection?: unknown }).useSelection === true
}

/** 读取相对路径：非空且不超长 */
function readPath(value: unknown, method: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_PATH_LENGTH) {
        throw new Error(`${method} 缺少有效的文档路径`)
    }
    return value.trim()
}

/** 读取非负整数偏移 */
function readOffset(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`校对偏移非法：${field}`)
    }
    return value
}

/** 收窄单条写回条目 */
function readApplyEdit(value: unknown): ProofreadApplyEdit {
    if (typeof value !== 'object' || value === null) {
        throw new Error('校对写回条目非法')
    }
    const source = value as { start?: unknown; end?: unknown; quote?: unknown; replacement?: unknown }
    const quote = typeof source.quote === 'string' ? source.quote : ''
    const replacement = typeof source.replacement === 'string' ? source.replacement : null
    if (quote.length === 0 || quote.length > MAX_QUOTE_LENGTH || replacement === null) {
        throw new Error('校对写回条目缺少原文或替换文本')
    }
    if (replacement.length > MAX_REPLACEMENT_LENGTH) {
        throw new Error('校对替换文本过长')
    }
    return {
        start: readOffset(source.start, 'start'),
        end: readOffset(source.end, 'end'),
        quote,
        replacement,
    }
}

/** 收窄写回请求 */
function readApplyRequest(payload: unknown): ProofreadApplyRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('proofread/apply 缺少参数')
    }
    const source = payload as { path?: unknown; offsetBase?: unknown; edits?: unknown }
    if (!Array.isArray(source.edits) || source.edits.length === 0) {
        throw new Error('没有可应用的修改')
    }
    if (source.edits.length > MAX_EDITS) {
        throw new Error(`单次写回条数过多：上限 ${String(MAX_EDITS)} 条`)
    }
    return {
        path: readPath(source.path, 'proofread/apply'),
        offsetBase: readOffset(source.offsetBase, 'offsetBase'),
        edits: source.edits.map((item) => readApplyEdit(item)),
    }
}

/** 词条数上限：与词库存储层保持一致 */
const MAX_LEXICON_ENTRIES = 2000

/** 忽略词数上限 */
const MAX_LEXICON_IGNORES = 500

/** 单个词条长度上限 */
const MAX_LEXICON_WORD = 32

/** 词条说明长度上限 */
const MAX_LEXICON_NOTE = 120

/** 收窄词库保存请求：任一条目不合法即整体拒绝，不做静默丢弃 */
function readLexiconPayload(payload: unknown): ProofreadLexicon {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('proofread/lexicon/save 缺少参数')
    }
    const source = payload as { entries?: unknown; ignores?: unknown }
    if (!Array.isArray(source.entries) || !Array.isArray(source.ignores)) {
        throw new Error('词库格式非法：entries 与 ignores 必须是数组')
    }
    if (source.entries.length > MAX_LEXICON_ENTRIES) {
        throw new Error(`词条数超出上限（${String(MAX_LEXICON_ENTRIES)} 条）`)
    }
    if (source.ignores.length > MAX_LEXICON_IGNORES) {
        throw new Error(`忽略词数超出上限（${String(MAX_LEXICON_IGNORES)} 个）`)
    }
    const entries: ProofreadLexiconEntry[] = []
    for (const item of source.entries) {
        if (typeof item !== 'object' || item === null) {
            throw new Error('词条格式非法')
        }
        const row = item as { wrong?: unknown; right?: unknown; mode?: unknown; note?: unknown }
        const wrong = typeof row.wrong === 'string' ? row.wrong.trim() : ''
        const right = typeof row.right === 'string' ? row.right.trim() : ''
        if (
            wrong.length === 0 ||
            right.length === 0 ||
            wrong.length > MAX_LEXICON_WORD ||
            right.length > MAX_LEXICON_WORD
        ) {
            throw new Error('词条的错误写法与建议写法都不能为空，且不超过 32 字')
        }
        const entry: ProofreadLexiconEntry = { wrong, right, mode: row.mode === 'flag' ? 'flag' : 'replace' }
        if (typeof row.note === 'string' && row.note.trim().length > 0) {
            entry.note = row.note.trim().slice(0, MAX_LEXICON_NOTE)
        }
        entries.push(entry)
    }
    const ignores: string[] = []
    for (const item of source.ignores) {
        const word = typeof item === 'string' ? item.trim() : ''
        if (word.length === 0 || word.length > MAX_LEXICON_WORD) {
            throw new Error('忽略词不能为空，且不超过 32 字')
        }
        ignores.push(word)
    }
    return { version: 1, entries, ignores }
}

/** 收窄同意标记：只接受布尔值，不做字符串兼容 */
function readAccepted(payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('proofread/aiDetect/consent 缺少参数')
    }
    const accepted = (payload as { accepted?: unknown }).accepted
    if (typeof accepted !== 'boolean') {
        throw new Error('上传同意标记非法')
    }
    return accepted
}

/** 收窄定位请求 */
function readRevealRequest(payload: unknown): ProofreadRevealRequest {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('proofread/reveal 缺少参数')
    }
    const source = payload as { path?: unknown; documentStart?: unknown; documentEnd?: unknown }
    return {
        path: readPath(source.path, 'proofread/reveal'),
        documentStart: readOffset(source.documentStart, 'documentStart'),
        documentEnd: readOffset(source.documentEnd, 'documentEnd'),
    }
}
