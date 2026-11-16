/**
 * 笔记本条目：只承担折叠容器与行壳，折叠头交给 NotebookHeaderButton，行尾操作交给 NotebookRowActions。
 * 复用 @components/ui 的 collapsible 承载受控折叠，组内笔记由 NotebookNotes 渲染，本组件不读数据。
 * 关键约束：操作区以浮层贴着行尾（默认 opacity-0 + pointer-events-none），既不占位让计数真正贴右，
 * 也不拦截行点击；组内笔记的读取态与选中态以 notes 上下文整包下传，本组件不做逐项转发。
 */
import { Collapsible, CollapsibleContent } from '@components/ui/collapsible'
import type { NotebookSummary } from '@shared/types/notebook'
import { NotebookHeaderButton } from './NotebookHeader'
import { NotebookNotes } from './NotebookNotes'
import { NotebookRowActions } from './NotebookRowActions'
import type { NotebookNotesContext } from './types'
import type { JSX } from 'react'

interface NotebookItemProps {
    notebook: NotebookSummary
    isOpen: boolean
    /** 组内笔记的读取态与选中态：本组件不消费，原样交给 NotebookNotes */
    notes: NotebookNotesContext
    onToggleOpen: () => void
    onAddNote: () => void
    onRename: () => void
    onTogglePin: () => void
    onDelete: () => void
}

export function NotebookItem({
    notebook,
    isOpen,
    notes,
    onToggleOpen,
    onAddNote,
    onRename,
    onTogglePin,
    onDelete,
}: NotebookItemProps): JSX.Element {
    return (
        <Collapsible open={isOpen} onOpenChange={onToggleOpen}>
            <div className="group/notebook relative flex items-center gap-1 rounded-full pr-1 hover:bg-muted/60">
                <NotebookHeaderButton notebook={notebook} isOpen={isOpen} />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-hover/notebook:hidden">
                    {notebook.noteCount}
                </span>
                <NotebookRowActions
                    notebook={notebook}
                    isRenameDeleteDisabled={notebook.isUnclassified}
                    onAddNote={onAddNote}
                    onRename={onRename}
                    onTogglePin={onTogglePin}
                    onDelete={onDelete}
                />
            </div>
            <CollapsibleContent>
                <div className="py-1 pl-3">
                    <NotebookNotes notes={notes} />
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}
