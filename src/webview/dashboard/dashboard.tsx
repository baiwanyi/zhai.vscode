/**
 * 仪表盘页面：顶部操作区固定，滚动区依次呈现概览槽位、功能入口与笔记列表，底部固定多选操作栏与提示行。
 * 数据与动作经 useDashboardStats / useNotesList / useDashboardActions 三层 hook 下发，页面只做组合。
 * 交互约束：重建索引期间由统计 hook 轮询收敛按钮态；新建笔记成功后选中新条目以便在列表中定位；
 * 批量操作栏仅在多选态且有选中项时出现，其按钮语义由选中项的置顶状态决定。
 */
import { useCallback, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotesList } from './hooks/useNotesList'
import { DashboardEntries } from './layout/DashboardEntries'
import { DashboardSlots } from './layout/DashboardSlots'
import { DashboardStatusHint } from './layout/DashboardStatusHint'
import { DashboardTopBar } from './layout/DashboardTopBar'
import { NotesSection } from './layout/NotesSection'
import { NotesSelectionBar } from './layout/NotesSelectionBar'
import type { JSX } from 'react'

export function Dashboard(): JSX.Element {
    const { stats, status, error, reload } = useDashboardStats()
    const {
        pinnedNotes,
        unpinnedNotes,
        modules,
        activeModules,
        isFiltered,
        isSelecting,
        selectedPaths,
        isAllSelectedPinned,
        toggleModule,
        resetFilters,
        toggleSelecting,
        toggleSelected,
    } = useNotesList(stats)
    const {
        pendingAction,
        notice,
        actionError,
        createNote,
        setPinned,
        rebuild,
        clearCache,
        openSettings,
        showPending,
        showNotePending,
    } = useDashboardActions(reload)
    const [activeId, setActiveId] = useState<string | null>(null)

    /** 新建空笔记后把返回路径设为选中项 */
    const handleCreate = useCallback(async (): Promise<void> => {
        const created = await createNote()
        if (created !== null) {
            setActiveId(created.path)
        }
    }, [createNote])

    return (
        <div className="flex h-screen flex-col">
            <div className="px-3 pt-3">
                <DashboardTopBar
                    isBusy={pendingAction !== null}
                    isRebuilding={stats?.isRebuilding === true}
                    onAdd={() => void handleCreate()}
                    onRebuild={() => void rebuild()}
                    onClearCache={() => void clearCache()}
                    onOpenSettings={() => void openSettings()}
                />
            </div>
            <div className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                    <div className="flex flex-col gap-3 p-3">
                        <DashboardSlots />
                        <DashboardEntries
                            onOpenWriting={() => showPending('writing')}
                            onOpenPress={() => showPending('press')}
                        />
                        <NotesSection
                            pinnedNotes={pinnedNotes}
                            unpinnedNotes={unpinnedNotes}
                            modules={modules}
                            status={status}
                            error={error}
                            isFiltered={isFiltered}
                            activeId={activeId}
                            activeModules={activeModules}
                            isSelecting={isSelecting}
                            selectedPaths={selectedPaths}
                            onSelect={(path) => {
                                setActiveId(path)
                                showNotePending('open')
                            }}
                            onInvoke={(path, action) => {
                                if (action === 'pin' || action === 'unpin') {
                                    void setPinned([path], action === 'pin')
                                    return
                                }
                                showNotePending(action)
                            }}
                            onToggleModule={toggleModule}
                            onResetFilters={resetFilters}
                            onToggleSelecting={toggleSelecting}
                            onToggleSelected={toggleSelected}
                        />
                    </div>
                </ScrollArea>
            </div>
            <div className="mt-2 border-t px-3 pt-2 pb-3">
                {isSelecting && selectedPaths.length > 0 ? (
                    <NotesSelectionBar
                        isAllSelectedPinned={isAllSelectedPinned}
                        onTogglePin={() => void setPinned(selectedPaths, !isAllSelectedPinned)}
                        onDelete={() => showNotePending('delete')}
                    />
                ) : null}
                <DashboardStatusHint error={actionError} notice={notice} />
            </div>
        </div>
    )
}
