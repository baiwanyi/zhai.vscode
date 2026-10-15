/**
 * 仪表盘页面：顶部操作区固定，滚动区依次呈现概览槽位、功能入口与笔记列表，底部固定提示行。
 * 数据与动作经 useDashboardStats / useNotesList / useDashboardActions 三层 hook 下发，页面只做组合。
 * 交互约束：重建索引期间由统计 hook 轮询收敛按钮态；未接入宿主协议的入口以底部提示行反馈。
 */
import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotesList } from './hooks/useNotesList'
import { DashboardEntries } from './layout/DashboardEntries'
import { DashboardSlots } from './layout/DashboardSlots'
import { DashboardStatusHint } from './layout/DashboardStatusHint'
import { DashboardTopBar } from './layout/DashboardTopBar'
import { NotesSection } from './layout/NotesSection'
import type { JSX } from 'react'

export function Dashboard(): JSX.Element {
    const { stats, status, error, reload } = useDashboardStats()
    const { notes, modules, viewMode, activeModules, isFiltered, setViewMode, toggleModule, resetFilters } =
        useNotesList(stats)
    const { pendingAction, notice, actionError, rebuild, clearCache, openSettings, showPending, showNotePending } =
        useDashboardActions(reload)
    const [activeId, setActiveId] = useState<string | null>(null)

    return (
        <div className="flex h-screen flex-col">
            <div className="px-3 pt-3">
                <DashboardTopBar
                    isBusy={pendingAction !== null}
                    isRebuilding={stats?.isRebuilding === true}
                    onAdd={() => showPending('add')}
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
                            notes={notes}
                            modules={modules}
                            status={status}
                            error={error}
                            isFiltered={isFiltered}
                            activeId={activeId}
                            viewMode={viewMode}
                            activeModules={activeModules}
                            onSelect={(path) => {
                                setActiveId(path)
                                showNotePending('open')
                            }}
                            onInvoke={(_path, action) => showNotePending(action)}
                            onViewModeChange={setViewMode}
                            onToggleModule={toggleModule}
                            onResetFilters={resetFilters}
                        />
                    </div>
                </ScrollArea>
            </div>
            <div className="pb-3">
                <DashboardStatusHint error={actionError} notice={notice} />
            </div>
        </div>
    )
}
