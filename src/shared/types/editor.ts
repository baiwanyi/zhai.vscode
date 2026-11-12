/**
 * 编辑区富文本编辑器的跨进程契约：文档快照、块级变更与只读判定。
 * 复用约定：Webview 与宿主共用同一份类型，块下标即 mdast 顶层节点下标，回写按该下标定位原文；
 * version 取 TextDocument.version，用于拒绝过期回写，避免与外部修改互相覆盖。
 * 关键约束：frontmatter 不属于正文块，单独原样透传；editable 为 false 时界面必须转只读预览，
 * 不得只隐藏按钮——只读是防止不支持语法被回写破坏的唯一保障。
 */

/** 一个顶层块的渲染结果：html 供 TipTap 输入，start/end 为全文偏移，回写时替换该区间 */
export interface EditorBlock {
    html: string
    start: number
    end: number
}

/** 文档快照：blocks 与正文顶层节点一一对应，下标即回写定位依据 */
export interface EditorDocSnapshot {
    path: string
    version: number
    frontmatter: string
    blocks: EditorBlock[]
    /** 是否允许编辑：文档含白名单外语法时为 false，界面转只读预览 */
    editable: boolean
}

/** 单个块的变更：index 对应快照 blocks 下标，html 为该块编辑后的顶层元素 HTML */
export interface EditorBlockChange {
    index: number
    html: string
}

/** 回写请求载荷：只允许提交发生变化的块，未变化的块由宿主保留原始 Markdown 文本 */
export interface EditorChangeRequest {
    path: string
    version: number
    blocks: EditorBlockChange[]
}

/** 回写结果：appliedBlocks 为实际替换的块数，stale 为版本过期未写入，version 为写入后的文档版本 */
export interface EditorChangeResult {
    appliedBlocks: number
    stale: boolean
    /** 写入后的 TextDocument.version：前端据此更新基准，否则下一次回写必然 stale */
    version: number
    /** 写入前自检未通过的原因：目前只有「修改会引入暂不支持的语法」 */
    rejected?: 'unsupported-syntax'
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

/** 源码模式快照：原文全文 + 版本，供纯文本编辑与整篇回写 */
export interface EditorSourceResult {
    path: string
    version: number
    content: string
}

/** 源码模式保存：整篇替换，version 用于拒绝过期写入 */
export interface EditorSourceSaveRequest {
    path: string
    version: number
    content: string
}

/** 源码模式保存结果：stale 为版本过期未写入 */
export interface EditorSourceSaveResult {
    saved: boolean
    stale: boolean
    version: number
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

/** 收窄源码保存请求：content 允许为空（用户可能清空全文） */
export function isEditorSourceSaveRequest(input: unknown): input is EditorSourceSaveRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { path?: unknown; version?: unknown; content?: unknown }
    return (
        typeof request.path === 'string' && typeof request.version === 'number' && typeof request.content === 'string'
    )
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
export type HighlightColor = 'coral' | 'violet' | 'blue' | 'emerald' | 'amber'

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

/** 颜色枚举的运行时白名单：与类型定义同源，供守卫复用 */
const HIGHLIGHT_COLOR_VALUES: readonly string[] = ['coral', 'violet', 'blue', 'emerald', 'amber']

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
    const { path, version, blocks } = input as { path?: unknown; version?: unknown; blocks?: unknown }
    if (typeof path !== 'string' || typeof version !== 'number' || !Array.isArray(blocks)) {
        return false
    }
    return blocks.every((item) => {
        if (typeof item !== 'object' || item === null) {
            return false
        }
        const { index, html } = item as { index?: unknown; html?: unknown }
        return typeof index === 'number' && typeof html === 'string'
    })
}
