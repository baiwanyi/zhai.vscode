/**
 * 笔记模块的纯展示工具：把笔记本条目的可读名拼成一句话，供折叠头的 aria-label 使用。
 * 复用 @shared/types/notebook 的 NotebookSummary 字段，不引入 React 依赖，便于单测。
 * 关键约束：折叠头内的图标与徽章对屏幕阅读器不可读，数量与标记必须由文案补齐，缺失项不占位。
 */
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
