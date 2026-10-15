/**
 * 笔记契约：宿主 note/create 请求的返回结构。
 * 使用方：Webview 仪表盘的「添加」入口与宿主侧笔记服务。
 * 约束：path 为相对存储根的路径，与索引库 files.path 同口径，前端据此定位列表条目。
 */

/** 新建空笔记的结果 */
export interface CreatedNote {
    /** 相对存储根的文件路径，形如 notes/202610/{uuid}.md */
    path: string
    /** 笔记标题，与写入的 Frontmatter title 一致 */
    title: string
}
