/**
 * 笔记本列表：按宿主排定顺序逐个渲染可折叠的笔记本分组，自身不取数、不持有展开状态。
 * 复用了同目录 NotebookItem，展开集合与组内笔记由页面 useNotebooks 下发。
 * 关键约束：顺序一律沿用页面下发顺序，本组件不排序；条目间保持紧凑间距，折叠区展开后不额外插分隔符。
 */
import type { NoteAction } from '@shared/types/dashboard'
import type { NotebookSummary } from '@shared/types/notebook'
import { NotebookItem } from './NotebookItem'
import type { NotebookNotesEntry } from './types'
import type { JSX } from 'react'

interface NotebookListProps {
    notebooks: NotebookSummary[]
    isOpen: (id: string) => boolean
    notesOf: (id: string) => NotebookNotesEntry | null
    activeId: string | null
    isSelecting: boolean
    selectedPaths: string[]
    onToggleOpen: (id: string) => void
    onAddNote: (id: string) => void
    onRename: (notebook: NotebookSummary) => void
    onTogglePin: (notebook: NotebookSummary) => void
    onDelete: (notebook: NotebookSummary) => void
    onOpenNote: (path: string) => void
    onInvokeNote: (path: string, action: NoteAction) => void
    onToggleSelected: (path: string) => void
}

export function NotebookList({
    notebooks,
    isOpen,
    notesOf,
    activeId,
    isSelecting,
    selectedPaths,
    onToggleOpen,
    onAddNote,
    onRename,
    onTogglePin,
    onDelete,
    onOpenNote,
    onInvokeNote,
    onToggleSelected,
}: NotebookListProps): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            {notebooks.map((notebook) => (
                <NotebookItem
                    key={notebook.id}
                    notebook={notebook}
                    isOpen={isOpen(notebook.id)}
                    notes={{
                        entry: notesOf(notebook.id),
                        activeId,
                        isSelecting,
                        selectedPaths,
                        onOpenNote,
                        onInvokeNote,
                        onToggleSelected,
                    }}
                    onToggleOpen={() => onToggleOpen(notebook.id)}
                    onAddNote={() => onAddNote(notebook.id)}
                    onRename={() => onRename(notebook)}
                    onTogglePin={() => onTogglePin(notebook)}
                    onDelete={() => onDelete(notebook)}
                />
            ))}
        </div>
    )
}
