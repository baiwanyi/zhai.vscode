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
