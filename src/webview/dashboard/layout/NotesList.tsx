/**
 * 笔记列表：铺排条目集合，普通态的选中高亮由 activeId 决定，多选态改由复选圈表达。
 * 组合同目录 NotesListItem 呈现单条；滚动与高度由区块外层承担，本组件不做虚拟化。
 * 关键约束：列表语义由 ItemGroup 提供，禁止改用裸 div 堆叠条目；多选态下不再高亮 activeId。
 */
import { ItemGroup } from '@/components/ui/item'
import type { NoteAction, RecentFile } from '@/shared/types/dashboard'
import { NotesListItem } from './NotesListItem'
import type { JSX } from 'react'

interface NotesListProps {
    notes: RecentFile[]
    activeId: string | null
    isSelecting: boolean
    selectedPaths: string[]
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
    onToggleSelected: (path: string) => void
}

export function NotesList({
    notes,
    activeId,
    isSelecting,
    selectedPaths,
    onSelect,
    onInvoke,
    onToggleSelected,
}: NotesListProps): JSX.Element {
    return (
        <ItemGroup className="gap-1">
            {notes.map((note) => (
                <NotesListItem
                    key={note.path}
                    note={note}
                    isActive={!isSelecting && note.path === activeId}
                    isSelecting={isSelecting}
                    isSelected={selectedPaths.includes(note.path)}
                    onSelect={() => onSelect(note.path)}
                    onInvoke={(action) => onInvoke(note.path, action)}
                    onToggleSelected={() => onToggleSelected(note.path)}
                />
            ))}
        </ItemGroup>
    )
}
