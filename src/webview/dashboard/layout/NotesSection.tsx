/**
 * 笔记列表区块：卡片内组合标题行操作、置顶分组与状态分派，自身不取数、不持有筛选状态。
 * 数据与筛选经页面 useNotesList 下发；无可用数据时交由 NotesListState 呈现三态。
 * 关键约束：标题行操作置于 CardAction 槽位以对齐卡片头部网格；
 * 多选态的批量操作栏由页面底部承担，本区块不承载任何操作按钮。
 */
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ModuleStat, NoteAction, RecentFile } from '@/shared/types/dashboard'
import { NotesHeaderActions } from './NotesHeaderActions'
import { NotesList } from './NotesList'
import { NotesListState } from './NotesListState'
import type { StatsStatus } from '../hooks/useDashboardStats'
import type { JSX } from 'react'

interface NotesSectionProps {
    /** 置顶分组，顺序由宿主排定 */
    pinnedNotes: RecentFile[]
    /** 置顶之外的其余笔记 */
    unpinnedNotes: RecentFile[]
    modules: ModuleStat[]
    status: StatsStatus
    error: string | null
    isFiltered: boolean
    activeId: string | null
    activeModules: string[]
    isSelecting: boolean
    selectedPaths: string[]
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
    onToggleModule: (name: string) => void
    onResetFilters: () => void
    onToggleSelecting: () => void
    onToggleSelected: (path: string) => void
}

export function NotesSection({
    pinnedNotes,
    unpinnedNotes,
    modules,
    status,
    error,
    isFiltered,
    activeId,
    activeModules,
    isSelecting,
    selectedPaths,
    onSelect,
    onInvoke,
    onToggleModule,
    onResetFilters,
    onToggleSelecting,
    onToggleSelected,
}: NotesSectionProps): JSX.Element {
    const hasNotes = status === 'ready' && pinnedNotes.length + unpinnedNotes.length > 0
    const selectedCount = selectedPaths.length

    return (
        <Card size="sm" className="ring-0">
            <CardHeader className="px-0 items-center">
                <CardTitle>
                    {isSelecting ? (selectedCount > 0 ? `已选择 ${selectedCount} 个笔记` : '选择笔记') : '笔记列表'}
                </CardTitle>
                <CardAction className="row-span-1">
                    <NotesHeaderActions
                        modules={modules}
                        activeModules={activeModules}
                        isSelecting={isSelecting}
                        onToggleModule={onToggleModule}
                        onResetFilters={onResetFilters}
                        onToggleSelecting={onToggleSelecting}
                    />
                </CardAction>
            </CardHeader>
            <CardContent className="px-0">
                {hasNotes ? (
                    <NotesList
                        pinnedNotes={pinnedNotes}
                        unpinnedNotes={unpinnedNotes}
                        activeId={activeId}
                        isSelecting={isSelecting}
                        selectedPaths={selectedPaths}
                        onSelect={onSelect}
                        onInvoke={onInvoke}
                        onToggleSelected={onToggleSelected}
                    />
                ) : (
                    <NotesListState
                        status={status}
                        error={error}
                        isFiltered={isFiltered}
                        onResetFilters={onResetFilters}
                    />
                )}
            </CardContent>
        </Card>
    )
}
