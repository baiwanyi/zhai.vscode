/**
 * 编辑区富文本编辑器的跨进程契约：文档快照、块级变更与只读判定。
 * 复用约定：Webview 与宿主共用同一份类型，回写按全文偏移定位原文区间，而不是按块下标；
 * version 取 TextDocument.version，用于拒绝过期回写，避免与外部修改互相覆盖。
 * 关键约束：frontmatter 不属于正文块，单独原样透传；语法能否往返不作为拒绝编辑的理由——
 * 宿主恒返回 editable: true，渲染不出的语法按纯文本呈现，不设源码块标识也不转只读；
 * 块下标只在同一版本内有效，插入 / 删除块会让后续下标整体位移，故回写一律带 start/end。
 */

/** 一个顶层块的渲染结果：html 供 TipTap 输入，start/end 为全文偏移，回写时替换该区间 */
export interface EditorBlock {
    html: string
    start: number
    end: number
}

/** 文档快照：blocks 与正文顶层节点一一对应，start/end 即回写定位依据 */
export interface EditorDocSnapshot {
    path: string
    version: number
    frontmatter: string
    blocks: EditorBlock[]
    /** 是否允许编辑：宿主恒返回 true，保留字段只为兼容既有协议与前端分支 */
    editable: boolean
}

/**
 * 一处区间变更：htmls 是替换该区间的块 HTML（通常一块，插入多个块时为多块），
 * 空数组表示删除该区间；start === end 表示纯插入。
 */
export interface EditorBlockChange {
    start: number
    end: number
    htmls: string[]
}

/** 回写请求载荷：只提交发生变化的区间，未变化的块由宿主保留原始 Markdown 文本 */
export interface EditorChangeRequest {
    path: string
    version: number
    edits: EditorBlockChange[]
}

/** 回写结果：appliedBlocks 为实际替换的区间数，stale 为版本过期未写入，version 为写入后的文档版本 */
export interface EditorChangeResult {
    appliedBlocks: number
    stale: boolean
    /** 写入后的 TextDocument.version：前端据此更新基准，否则下一次回写必然 stale */
    version: number
    /** 写入后的块区间：前端据此刷新基准偏移，不必等下一次快照推送 */
    blocks?: EditorBlock[]
    /** 宿主侧没能落盘（applyEdit 被拒绝等）：前端据此提示，避免「静默成功」 */
    failed?: boolean
    /**
     * 本次请求里被转换环节丢弃的区间数（越界、重叠、合并单元格、空内容）。
     * appliedBlocks 为 0 时它表示「整批改动都没落盘」，前端必须提示且不得刷新基准偏移。
     */
    discarded?: number
}

/** 编辑区查询请求：选中文本 + 问题，路径用于归属校验，clientId 用于匹配流式回包 */
export interface EditorQueryRequest {
    path: string
    quote: string
    question: string
    /** 前端生成的关联 id：宿主的增量与终态都带上它，避免多窗口串流 */
    clientId: string
}

/** 查询流增量：宿主按 clientId 推给 webview */
export interface EditorQueryDelta {
    kind: 'query'
    clientId: string
    delta: string
}

/** 查询结束：status 为 error 时 reason 必有值 */
export interface EditorQueryDone {
    kind: 'query'
    clientId: string
    status: 'done' | 'error'
    reason: string | null
    content: string
    /** 命中缓存：界面据此标出「来自缓存」，提示本次未消耗额度 */
    fromCache: boolean
}

/** 取消查询：按 clientId 定位在途请求 */
export interface EditorQueryAbortRequest {
    clientId: string
}

/** 收窄取消请求 */
export function isEditorQueryAbortRequest(input: unknown): input is EditorQueryAbortRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { clientId?: unknown }
    return typeof request.clientId === 'string' && request.clientId.length > 0
}

/** 收窄查询请求：quote 必须非空，question 允许为空（用默认问题） */
export function isEditorQueryRequest(input: unknown): input is EditorQueryRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { path?: unknown; quote?: unknown; question?: unknown; clientId?: unknown }
    return (
        typeof request.path === 'string' &&
        typeof request.quote === 'string' &&
        request.quote.trim() !== '' &&
        typeof request.question === 'string' &&
        typeof request.clientId === 'string' &&
        request.clientId.length > 0
    )
}

/** 列表游标：keyset 分页，避免深 OFFSET 扫描 */
export interface AnnotationCursor {
    createdAt: string
    id: string
}

/** 总览页查询条件：全部字段可空，空表示不限 */
export interface AnnotationListQuery {
    cursor: AnnotationCursor | null
    /** 每页条数：默认 50，上限 200 */
    limit: number
    kind: AnnotationKind | null
    color: HighlightColor | null
    docPath: string | null
    orphanedOnly: boolean
    /** 关键词：≥3 字走 FTS，1–2 字走 LIKE */
    keyword: string
}

/** 列表结果：total 只在首页返回，避免每次翻页都做一次全量 COUNT */
export interface AnnotationListResult {
    items: AnnotationRecord[]
    nextCursor: AnnotationCursor | null
    total: number | null
}

/** 总览统计：按类型与颜色分组 */
export interface AnnotationStats {
    total: number
    highlights: number
    notes: number
    orphaned: number
    byColor: Record<HighlightColor, number>
}

/** 有标注的文档清单：供总览页的文档维度筛选，docTitle 取该文档最近一条记录 */
export interface AnnotationDocumentSummary {
    docPath: string
    docTitle: string
    count: number
}

/** 快照消息：在文档快照基础上补资源前缀，图片据此拼出 webview 可访问地址 */
export interface EditorSnapshotMessage extends EditorDocSnapshot {
    /** 存储根的 webview URL 前缀，形如 https://file+.vscode-resource...；拼接 `@zhai/` 引用时使用 */
    assetPrefix: string
}

/** 插入内容：图片插节点、其余插文本，两者互斥；宿主与 webview 共用这一层结构 */
export interface EditorInsertContent {
    image: { src: string; alt: string } | null
    text: string | null
}

/** 插入请求：在内容之上加一个 kind 判别字段，供 webview 的 state 通道分流 */
export interface EditorInsertPayload extends EditorInsertContent {
    kind: 'insert'
}

/** 收窄插入请求：image 与 text 至少有一个 */
export function isEditorInsertPayload(input: unknown): input is EditorInsertPayload {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const value = input as { kind?: unknown; image?: unknown; text?: unknown }
    if (value.kind !== 'insert') {
        return false
    }
    const hasImage =
        typeof value.image === 'object' &&
        value.image !== null &&
        typeof (value.image as { src?: unknown }).src === 'string' &&
        typeof (value.image as { alt?: unknown }).alt === 'string'
    const hasText = typeof value.text === 'string'
    return hasImage || hasText
}

/** 收窄快照消息：在文档快照校验之上再要求 assetPrefix 为非空字符串 */
export function isEditorSnapshotMessage(input: unknown): input is EditorSnapshotMessage {
    if (!isEditorDocSnapshot(input)) {
        return false
    }
    const value = input as { assetPrefix?: unknown }
    return typeof value.assetPrefix === 'string'
}

/** 富文本选区上报：宿主据此知道用户在富文本里选了什么，用于选区引用与写回定位 */
export interface EditorSelectionRequest {
    path: string
    /** 选区纯文本：跨块时为空串（宿主无法用整段文字在 Markdown 中定位） */
    quote: string
    /** 选区起点所在块序号；跨块或空选区为 -1 */
    blockIndex: number
    /** 是否为空选区（只有光标） */
    isEmpty: boolean
}

/** 收窄选区上报请求 */
export function isEditorSelectionRequest(input: unknown): input is EditorSelectionRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const value = input as { path?: unknown; quote?: unknown; blockIndex?: unknown; isEmpty?: unknown }
    return (
        typeof value.path === 'string' &&
        typeof value.quote === 'string' &&
        typeof value.blockIndex === 'number' &&
        typeof value.isEmpty === 'boolean'
    )
}

/** 富文本定位请求：标注总览跳转时，若文档已在富文本 tab 中，直接选中并滚动到原文 */
export interface EditorRevealPayload {
    kind: 'reveal'
    quote: string
    blockIndex: number
}

/** 收窄定位请求：blockIndex 允许为 -1（按全文搜索兜底） */
export function isEditorRevealPayload(input: unknown): input is EditorRevealPayload {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const value = input as { kind?: unknown; quote?: unknown; blockIndex?: unknown }
    return value.kind === 'reveal' && typeof value.quote === 'string' && typeof value.blockIndex === 'number'
}

/** 一条查询历史：缓存与历史共用同一张表，此处只暴露回看所需字段 */
export interface EditorQueryHistoryEntry {
    id: string
    quote: string
    question: string
    answer: string
    createdAt: string
}

/** 查询历史响应：按时间倒序，条数由宿主限制 */
export interface EditorQueryHistoryResult {
    items: EditorQueryHistoryEntry[]
}

/** 跨文档的 AI 解释记录：标注总览页据此展示，比单文档历史多出 docPath 与 model */
export interface EditorQueryRecord {
    id: string
    docPath: string
    quote: string
    question: string
    answer: string
    model: string
    createdAt: string
}

/** AI 解释记录列表：total 是符合关键词的总数，items 只取最近一页 */
export interface EditorQueryListResult {
    items: EditorQueryRecord[]
    total: number
}

/** 收窄快照：Webview 收到的是不可信数据，块结构与版本逐字段校验 */
export function isEditorDocSnapshot(input: unknown): input is EditorDocSnapshot {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const { path, version, frontmatter, blocks, editable } = input as {
        path?: unknown
        version?: unknown
        frontmatter?: unknown
        blocks?: unknown
        editable?: unknown
    }
    if (
        typeof path !== 'string' ||
        typeof version !== 'number' ||
        typeof frontmatter !== 'string' ||
        typeof editable !== 'boolean' ||
        !Array.isArray(blocks)
    ) {
        return false
    }
    return blocks.every((block) => {
        if (typeof block !== 'object' || block === null) {
            return false
        }
        const { html, start, end } = block as { html?: unknown; start?: unknown; end?: unknown }
        return typeof html === 'string' && typeof start === 'number' && typeof end === 'number'
    })
}

/** 划线颜色：固定枚举而非任意色值，保证深浅主题下的可读性 */
export type HighlightColor = 'amber' | 'blue' | 'coral' | 'emerald' | 'violet'

/** 标注类型：划线只存区间，批注额外有正文 */
export type AnnotationKind = 'highlight' | 'note'

/** 批注形态：inline 为自绘气泡，thread 为原生 Comment API 线程 */
export type AnnotationMode = 'inline' | 'thread'

/** 一条标注：docPath 为相对存储根路径，锚点四件套共同支撑重定位 */
export interface AnnotationRecord {
    id: string
    docPath: string
    /** 写入时的文档标题快照：总览页分组不依赖索引库 */
    docTitle: string
    kind: AnnotationKind
    mode: AnnotationMode
    /** 划线文本；批注时为目标文本 */
    quote: string
    prefix: string
    suffix: string
    startOffset: number
    endOffset: number
    /** 块运行期 id：仅在富文本打开期间有效，不写入 Markdown */
    blockId: string
    blockIndex: number
    blockHash: string
    /** 段落原文快照（截断 1000 字）：总览页展示「所在段落」 */
    blockText: string
    color: HighlightColor | null
    note: string | null
    /** 线程回复（JSON 字符串）：仅 mode=thread 使用 */
    replies: string
    orphaned: boolean
    createdAt: string
    updatedAt: string
}

/** 新增标注的入参：id 与时间由仓储生成 */
export type NewAnnotation = Omit<AnnotationRecord, 'id' | 'createdAt' | 'updatedAt'>

/** 颜色枚举的运行时白名单：与类型定义同源同序，供守卫复用 */
const HIGHLIGHT_COLOR_VALUES: readonly string[] = ['amber', 'blue', 'coral', 'emerald', 'violet']

/** 划线选区草稿：由 Webview 从 ProseMirror 文档算出，宿主只做校验与落库 */
export interface AnnotationDraft {
    quote: string
    prefix: string
    suffix: string
    startOffset: number
    endOffset: number
    blockId: string
    blockIndex: number
    blockHash: string
    blockText: string
}

/** 新建标注请求：kind 决定落库形态，划线带颜色、批注带正文 */
export interface AddAnnotationRequest {
    path: string
    kind: AnnotationKind
    /** 划线颜色；批注为 null */
    color: HighlightColor | null
    /** 批注正文；划线为 null */
    note: string | null
    draft: AnnotationDraft
}

/** 按 id 操作标注（删除、改色、改批注正文） */
export interface AnnotationIdRequest {
    path: string
    id: string
    /** 改色时必填；null 表示清除划线颜色 */
    color?: HighlightColor | null
    /** 批注正文：编辑批注时传，空串由守卫拦下 */
    note?: string
}

/** 收窄草案：数值与字符串逐字段校验，空白 quote 直接拒绝 */
export function isAnnotationDraft(input: unknown): input is AnnotationDraft {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const draft = input as Record<string, unknown>
    const stringKeys: readonly string[] = ['quote', 'prefix', 'suffix', 'blockId', 'blockHash', 'blockText']
    if (!stringKeys.every((key) => typeof draft[key] === 'string')) {
        return false
    }
    const numberKeys: readonly string[] = ['startOffset', 'endOffset', 'blockIndex']
    if (!numberKeys.every((key) => typeof draft[key] === 'number')) {
        return false
    }
    return draft.quote !== ''
}

/** 收窄新建请求：path 为相对存储根路径；划线必须有合法颜色，批注必须有非空正文 */
export function isAddAnnotationRequest(input: unknown): input is AddAnnotationRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { path?: unknown; kind?: unknown; color?: unknown; note?: unknown; draft?: unknown }
    if (typeof request.path !== 'string') {
        return false
    }
    if (request.kind !== 'highlight' && request.kind !== 'note') {
        return false
    }
    const hasValidColor =
        request.color === null || (typeof request.color === 'string' && HIGHLIGHT_COLOR_VALUES.includes(request.color))
    if (!hasValidColor) {
        return false
    }
    const hasValidNote = request.note === null || typeof request.note === 'string'
    if (!hasValidNote) {
        return false
    }
    if (request.kind === 'highlight' && request.color === null) {
        return false
    }
    if (request.kind === 'note' && (typeof request.note !== 'string' || request.note.trim() === '')) {
        return false
    }
    return isAnnotationDraft(request.draft)
}

/** 收窄按 id 操作请求：color 只允许缺省、null 或枚举值；note 缺省或非空字符串 */
export function isAnnotationIdRequest(input: unknown): input is AnnotationIdRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { path?: unknown; id?: unknown; color?: unknown; note?: unknown }
    if (typeof request.path !== 'string' || typeof request.id !== 'string') {
        return false
    }
    if (request.note !== undefined && (typeof request.note !== 'string' || request.note.trim() === '')) {
        return false
    }
    if (request.color === undefined || request.color === null) {
        return true
    }
    return typeof request.color === 'string' && HIGHLIGHT_COLOR_VALUES.includes(request.color)
}

/** 收窄回写请求：Webview 数据不可信，逐字段校验后才用于定位原文 */
export function isEditorChangeRequest(input: unknown): input is EditorChangeRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const { path, version, edits } = input as { path?: unknown; version?: unknown; edits?: unknown }
    if (typeof path !== 'string' || typeof version !== 'number' || !Array.isArray(edits)) {
        return false
    }
    return edits.every((item) => {
        if (typeof item !== 'object' || item === null) {
            return false
        }
        const { start, end, htmls } = item as { start?: unknown; end?: unknown; htmls?: unknown }
        if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) {
            return false
        }
        return Array.isArray(htmls) && htmls.every((html) => typeof html === 'string')
    })
}
