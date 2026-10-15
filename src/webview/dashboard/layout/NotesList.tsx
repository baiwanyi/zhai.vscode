/**
 * 笔记列表：置顶分组与其余条目分列铺排，置顶组可折叠；普通态选中高亮由 activeId 决定，多选态改由复选圈表达。
 * 组合同目录 NotesListItem 呈现单条，折叠语义复用 @/components/ui/collapsible；滚动与高度由区块外层承担，本组件不做虚拟化。
 * 关键约束：条目语义由 ItemGroup 提供，禁止改用裸 div 堆叠条目；
 * 仅存在置顶项时渲染「置顶」分组标题，其余条目保持扁平不设标题；条目顺序一律沿用宿主下发顺序；
 * 折叠只影响呈现层，不改变选中集合，也不影响置顶数据与批量操作范围。
 */
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ItemGroup } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import type { NoteAction, RecentFile } from '@/shared/types/dashboard'
import { NotesListItem } from './NotesListItem'
import type { JSX } from 'react'

interface NotesListProps {
    /** 置顶分组，顺序由宿主排定 */
    pinnedNotes: RecentFile[]
    /** 置顶之外的其余笔记 */
    unpinnedNotes: RecentFile[]
    activeId: string | null
    isSelecting: boolean
    selectedPaths: string[]
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
    onToggleSelected: (path: string) => void
}

export function NotesList({
    pinnedNotes,
    unpinnedNotes,
    activeId,
    isSelecting,
    selectedPaths,
    onSelect,
    onInvoke,
    onToggleSelected,
}: NotesListProps): JSX.Element {
    const renderItem = (note: RecentFile): JSX.Element => (
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
    )

    return (
        <div className="flex flex-col gap-2">
            {pinnedNotes.length > 0 ? (
                <section className="flex flex-col gap-2">
                    <Collapsible defaultOpen>
                        <CollapsibleTrigger className="group/pin flex w-full cursor-pointer items-center gap-1 px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                            <span className="text-sm text-muted-foreground">置顶</span>
                            <ChevronDown className="size-4 transition-transform group-data-[state=closed]/pin:-rotate-90" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                            <ItemGroup className="has-data-[size=xs]:gap-0 has-data-[size=sm]:gap-0">
                                {pinnedNotes.map(renderItem)}
                            </ItemGroup>
                        </CollapsibleContent>
                    </Collapsible>
                    <Separator />
                </section>
            ) : null}
            <ItemGroup className="has-data-[size=xs]:gap-0 has-data-[size=sm]:gap-0">
                {unpinnedNotes.map(renderItem)}
            </ItemGroup>
        </div>
    )
}
