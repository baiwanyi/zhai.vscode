/**
 * 笔记列表区块：卡片内组合标题行操作、列表与状态分派，自身不取数、不持有筛选状态。
 * 数据与筛选经页面 useNotesList 下发；无可用数据时交由 NotesListState 呈现三态。
 * 关键约束：标题行操作置于 CardAction 槽位，保证卡片头部的两列网格对齐。
 */
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ModuleStat, NoteAction, NotesViewMode, RecentFile } from '@/shared/types/dashboard'
import { NotesHeaderActions } from './NotesHeaderActions'
import { NotesList } from './NotesList'
import { NotesListState } from './NotesListState'
import type { StatsStatus } from '../hooks/useDashboardStats'
import type { JSX } from 'react'

interface NotesSectionProps {
    notes: RecentFile[]
    modules: ModuleStat[]
    status: StatsStatus
    error: string | null
    isFiltered: boolean
    activeId: string | null
    viewMode: NotesViewMode
    activeModules: string[]
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
    onViewModeChange: (mode: NotesViewMode) => void
    onToggleModule: (name: string) => void
    onResetFilters: () => void
}

export function NotesSection({
    notes,
    modules,
    status,
    error,
    isFiltered,
    activeId,
    viewMode,
    activeModules,
    onSelect,
    onInvoke,
    onViewModeChange,
    onToggleModule,
    onResetFilters,
}: NotesSectionProps): JSX.Element {
    const hasNotes = status === 'ready' && notes.length > 0

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>笔记列表</CardTitle>
                <CardAction>
                    <NotesHeaderActions
                        viewMode={viewMode}
                        modules={modules}
                        activeModules={activeModules}
                        onViewModeChange={onViewModeChange}
                        onToggleModule={onToggleModule}
                        onResetFilters={onResetFilters}
                    />
                </CardAction>
            </CardHeader>
            <CardContent>
                {hasNotes ? (
                    <NotesList
                        notes={notes}
                        activeId={activeId}
                        viewMode={viewMode}
                        onSelect={onSelect}
                        onInvoke={onInvoke}
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
