/**
 * 笔记模块的纯展示与形态工具：折叠头可读名、删除弹窗的标题反查表、笔记与笔记本的归属判定。
 * 复用 @shared/types 的 NotebookSummary / RecentFile 字段，不引入 React 依赖，便于单测。
 * 关键约束：折叠头内的图标与徽章对屏幕阅读器不可读，数量与标记必须由文案补齐，缺失项不占位；
 * 反查表按传入顺序合并，后者覆盖前者（调用方把搜索结果排在已展开笔记之后，取更新的标题）；
 * 笔记本 id 形如 notes/<目录>，与宿主 toNotebookId 同源，页面不再自行拼接前缀。
 */
import type { RecentFile } from '@shared/types/dashboard'
import type { NotebookSummary } from '@shared/types/notebook'

/** 折叠头可访问名：名称 + 笔记数 + 置顶 + 默认标记，分隔符与页面文案保持一致 */
export function formatNotebookLabel(
    notebook: Pick<NotebookSummary, 'name' | 'noteCount' | 'isPinned' | 'isDefault'>,
): string {
    const parts = [notebook.name, `${String(notebook.noteCount)} 条笔记`]
    if (notebook.isPinned) {
        parts.push('已置顶')
    }
    if (notebook.isDefault) {
        parts.push('默认笔记本')
    }
    return parts.join('，')
}

/**
 * 标题反查表：把多组笔记按顺序并入同一张 path → title 映射，同路径以后传入的组为准。
 * 调用方按「已展开的组内笔记 → 搜索命中」排序，使弹窗文案优先取到最新标题。
 */
export function buildTitleByPath(...groups: readonly (readonly RecentFile[])[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const group of groups) {
        for (const note of group) {
            map.set(note.path, note.title)
        }
    }
    return map
}

/** 笔记是否属于指定笔记本：笔记本 id 只认前两段，其下任意深度的笔记都归属该笔记本 */
export function isNoteUnderNotebook(path: string, notebookId: string): boolean {
    return path.startsWith(`${notebookId}/`)
}

/**
 * 笔记删除失败提示：单条给出具体原因，多条只给条数与首条原因，避免提示被逐条刷屏。
 * 笔记删除与笔记本删除共用（后者失败项同样是被拒搬移的笔记），两处文案口径一致；
 * 与仪表盘 utils 的 formatBatchFailure 不同：这里按「篇笔记」计数，不额外带动作词。
 */
export function formatNoteDeleteFailure(failures: readonly { message: string }[]): string {
    const [first] = failures
    if (first === undefined) {
        return '笔记删除失败'
    }
    return failures.length === 1 ? first.message : `${String(failures.length)} 篇笔记删除失败：${first.message}`
}
