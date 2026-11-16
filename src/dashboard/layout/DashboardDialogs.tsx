/**
 * 仪表盘弹窗群：笔记删除、笔记本新建/重命名/删除四个确认弹窗的统一挂载点。
 * 复用约定：状态与时序全部来自 useNotesDeleteDialog / useNotebookDialogs，本组件只做渲染分派与文案绑定。
 * 关键约束：open 恒为 true 且由状态非空决定挂载，关闭即卸载，不留半开弹窗；
 * 新建与重命名共用 NotebookNameDialog，靠 key 切换实例以重置输入框；
 * 在途态取各自 Hook 下发的布尔，与动作层的在途计数同源。
 */
import type { NotebookDialogsState } from '../hooks/useNotebookDialogs'
import type { NotesDeleteDialogState } from '../hooks/useNotesDeleteDialog'
import type { JSX } from 'react'
import { NotebookDeleteDialog } from '../note/NotebookDeleteDialog'
import { NotebookNameDialog } from '../note/NotebookNameDialog'
import { NotesDeleteDialog } from '../note/NotesDeleteDialog'

interface DashboardDialogsProps {
    notes: NotesDeleteDialogState
    notebook: NotebookDialogsState
}

export function DashboardDialogs({ notes, notebook }: DashboardDialogsProps): JSX.Element {
    return (
        <>
            {notes.isOpen ? (
                <NotesDeleteDialog
                    open
                    titles={notes.titles}
                    isSubmitting={notes.isSubmitting}
                    onOpenChange={notes.onOpenChange}
                    onConfirm={notes.onConfirm}
                />
            ) : null}

            {notebook.isCreateOpen ? (
                <NotebookNameDialog
                    key={notebook.createDialogKey}
                    open
                    mode="create"
                    isSubmitting={notebook.isCreating}
                    onOpenChange={notebook.onCreateOpenChange}
                    onSubmit={notebook.submitCreate}
                />
            ) : null}

            {notebook.renameTarget !== null ? (
                <NotebookNameDialog
                    key={notebook.renameTarget.id}
                    open
                    mode="rename"
                    initialName={notebook.renameTarget.name}
                    isSubmitting={notebook.isRenaming}
                    onOpenChange={notebook.onRenameOpenChange}
                    onSubmit={notebook.submitRename}
                />
            ) : null}

            {notebook.deleteTarget !== null ? (
                <NotebookDeleteDialog
                    open
                    notebookName={notebook.deleteTarget.name}
                    noteCount={notebook.deleteTarget.noteCount}
                    isSubmitting={notebook.isDeleting}
                    onOpenChange={notebook.onDeleteOpenChange}
                    onConfirm={notebook.confirmDelete}
                />
            ) : null}
        </>
    )
}
