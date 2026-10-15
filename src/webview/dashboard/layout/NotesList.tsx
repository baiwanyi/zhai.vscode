/**
 * 笔记列表：按视图密度铺排条目集合，选中态由 activeId 决定。
 * 组合同目录 NotesListItem 呈现单条；滚动与高度由区块外层承担，本组件不做虚拟化。
 * 关键约束：列表语义由 ItemGroup 提供，禁止改用裸 div 堆叠条目。
 */
import { cn } from 'cn'
import { ItemGroup } from '@/components/ui/item'
import type { NoteAction, NotesViewMode, RecentFile } from '@/shared/types/dashboard'
import { NotesListItem } from './NotesListItem'
import type { JSX } from 'react'

interface NotesListProps {
    notes: RecentFile[]
    activeId: string | null
    viewMode: NotesViewMode
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
}

export function NotesList({ notes, activeId, viewMode, onSelect, onInvoke }: NotesListProps): JSX.Element {
    const isCompact = viewMode === 'compact'

    return (
        <ItemGroup className={cn(isCompact ? 'gap-0.5' : 'gap-1')}>
            {notes.map((note) => (
                <NotesListItem
                    key={note.path}
                    note={note}
                    isActive={note.path === activeId}
                    isCompact={isCompact}
                    onSelect={() => onSelect(note.path)}
                    onInvoke={(action) => onInvoke(note.path, action)}
                />
            ))}
        </ItemGroup>
    )
}
