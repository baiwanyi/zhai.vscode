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

/** 新建划线请求 */
export interface AddAnnotationRequest {
    path: string
    color: HighlightColor
    draft: AnnotationDraft
}

/** 按 id 操作标注（删除、改色） */
export interface AnnotationIdRequest {
    path: string
    id: string
    /** 改色时必填；null 表示清除划线颜色 */
    color?: HighlightColor | null
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

/** 收窄新建请求：path 为相对存储根路径，颜色必须是枚举值 */
export function isAddAnnotationRequest(input: unknown): input is AddAnnotationRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { path?: unknown; color?: unknown; draft?: unknown }
    return (
        typeof request.path === 'string' &&
        typeof request.color === 'string' &&
        HIGHLIGHT_COLOR_VALUES.includes(request.color) &&
        isAnnotationDraft(request.draft)
    )
}

/** 收窄按 id 操作请求：color 只允许缺省、null 或枚举值 */
export function isAnnotationIdRequest(input: unknown): input is AnnotationIdRequest {
    if (typeof input !== 'object' || input === null) {
        return false
    }
    const request = input as { path?: unknown; id?: unknown; color?: unknown }
    if (typeof request.path !== 'string' || typeof request.id !== 'string') {
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
