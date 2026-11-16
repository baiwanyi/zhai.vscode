/**
 * 笔记本内的笔记列表：按读取状态分派骨架、错误与空态，命中后复用同目录 NotesListItem 逐条呈现。
 * 复用 @components/ui 的 item、skeleton 与同目录条目组件，行高与零间距与列表保持一致。
 * 关键约束：骨架行数固定且几何对齐真实条目（标题条 + 右侧时间占位），加载完成时行高与列宽都不跳变；
 * 空态只给一句提示与添加入口说明，不放大段引导文案，避免嵌套在折叠区内显得笨重；
 * 入参是整包上下文（notes），读取态与选中态同源取出，组件自身不持有任何状态。
 */
import { Item, ItemActions, ItemContent, ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import { NotesListItem } from './NotesListItem'
import type { NotebookNotesContext } from './types'
import type { JSX } from 'react'

/** 骨架行数：折叠区首屏不需要太多占位，两行足以表达「正在加载」 */
const SKELETON_ROW_KEYS = ['note-row-1', 'note-row-2']

interface NotebookNotesProps {
    /** 组内笔记的读取态与选中态，由笔记本条目整包下发 */
    notes: NotebookNotesContext
}

export function NotebookNotes({ notes }: NotebookNotesProps): JSX.Element {
    const { entry, activeId, isSelecting, selectedPaths, onOpenNote, onInvokeNote, onToggleSelected } = notes

    if (entry === null || (entry.status === 'loading' && entry.items.length === 0)) {
        return (
            <ItemGroup
                className="has-data-[size=xs]:gap-0 has-data-[size=sm]:gap-0"
                aria-busy="true"
                aria-label="正在加载笔记"
            >
                {SKELETON_ROW_KEYS.map((rowKey) => (
                    <Item key={rowKey} size="sm" className="rounded-full py-1.5">
                        <ItemContent className="min-w-0">
                            <Skeleton className="h-4 w-2/3" />
                        </ItemContent>
                        {/* 右侧按条目时间同宽留白：加载完成时列宽与行高都不跳 */}
                        <ItemActions className="shrink-0">
                            <Skeleton className="h-3 w-10" />
                        </ItemActions>
                    </Item>
                ))}
            </ItemGroup>
        )
    }

    if (entry.status === 'error') {
        return <p className="px-3 py-1 text-destructive text-xs">{entry.error ?? '笔记读取失败'}</p>
    }

    if (entry.items.length === 0) {
        return <p className="px-3 py-1 text-muted-foreground text-xs">暂无笔记，点上方「＋」新建</p>
    }

    return (
        <ItemGroup className="has-data-[size=xs]:gap-0 has-data-[size=sm]:gap-0">
            {entry.items.map((note) => (
                <NotesListItem
                    key={note.path}
                    note={note}
                    isActive={!isSelecting && note.path === activeId}
                    isSelecting={isSelecting}
                    isSelected={selectedPaths.includes(note.path)}
                    onSelect={() => onOpenNote(note.path)}
                    onInvoke={(action) => onInvokeNote(note.path, action)}
                    onToggleSelected={() => onToggleSelected(note.path)}
                />
            ))}
        </ItemGroup>
    )
}
