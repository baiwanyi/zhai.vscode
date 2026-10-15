/**
 * 笔记列表区块：卡片内组合标题行操作、列表、状态分派与多选操作栏，自身不取数、不持有筛选状态。
 * 数据与筛选经页面 useNotesList 下发；无可用数据时交由 NotesListState 呈现三态。
 * 关键约束：标题行操作置于 CardAction 槽位以对齐卡片头部网格；批量操作栏仅在多选态且有选中项时出现。
 */
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ModuleStat, NoteAction, RecentFile } from '@/shared/types/dashboard'
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
    activeModules: string[]
    isSelecting: boolean
    selectedPaths: string[]
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
    onToggleModule: (name: string) => void
    onResetFilters: () => void
    onToggleSelecting: () => void
    onToggleSelected: (path: string) => void
    onDeleteSelected: () => void
}

export function NotesSection({
    notes,
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
    onDeleteSelected,
}: NotesSectionProps): JSX.Element {
    const hasNotes = status === 'ready' && notes.length > 0
    const selectedCount = selectedPaths.length

    return (
        <Card size="sm" className="ring-0">
            <CardHeader>
                <CardTitle>
                    {isSelecting ? (selectedCount > 0 ? `已选择 ${selectedCount} 个笔记` : '选择笔记') : '笔记列表'}
                </CardTitle>
                <CardAction>
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
                        notes={notes}
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
            {isSelecting && selectedCount > 0 ? (
                <CardFooter className="justify-center border-t">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={onDeleteSelected}
                    >
                        <Trash2 />
                        删除
                    </Button>
                </CardFooter>
            ) : null}
        </Card>
    )
}
