/**
 * 笔记列表的纯前端类型：折叠区的读取态，以及下发给组内列表的选中态上下文。
 * 复用 @shared/types/dashboard 的 RecentFile 作为条目形状，不重复声明字段；宿主协议类型一律留在 @shared/types。
 * 关键约束：组件与 hooks 同时从这里取类型，避免展示层反向依赖 hooks 实现文件；
 * 此文件只放类型，不引入任何运行时代码，可被任意层安全引用。
 */
import type { NoteAction, RecentFile } from '@shared/types/dashboard'

/** 单个笔记本的笔记读取状态 */
export interface NotebookNotesEntry {
    status: 'loading' | 'ready' | 'error'
    items: RecentFile[]
    error: string | null
}

/** 组内笔记的上下文：读取态、选中态与条目动作整包下发，避免穿过笔记本条目逐项转发 */
export interface NotebookNotesContext {
    entry: NotebookNotesEntry | null
    activeId: string | null
    isSelecting: boolean
    selectedPaths: string[]
    onOpenNote: (path: string) => void
    onInvokeNote: (path: string, action: NoteAction) => void
    onToggleSelected: (path: string) => void
}
