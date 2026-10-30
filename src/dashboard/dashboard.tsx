/**
 * 仪表盘概览页：以 AppPage 骨架承载「入口区 + 笔记滚动区 + 贴底操作栏」三段。
 * 复用约定：外壳取 components/AppPage（入口区走 AppHeader、概览与列表走 AppContent 滚动、底部操作栏与多选栏走 AppFooter），
 * 底栏上方的渐变遮罩由 AppFooter 统一提供，页面不再自行声明。
 * 数据与动作经 useDashboardStats / useNotesList / useDashboardActions 三层 hook 下发，页面只做组合；
 * 操作结果统一由 useDashboardActions 经 sonner 反馈，Toaster 由路由外壳 dashboardScreen 统一挂载。
 * 交互约束：写作管理入口为页内路由跳转（由路由外壳下发的 onNavigate 承担），公众号管理走工作流面板，
 * 待办事项以模块卡片嵌在概览区（不单独成页）；
 * 重建索引期间由统计 hook 轮询收敛按钮态；选中条目即按 path 打开笔记，
 * 当前选中项以宿主广播的活跃编辑器为准（点击时先本地回填，关闭笔记后随焦点回退自动切回上一篇）；
 * 批量操作栏仅在多选态且有选中项时出现，其按钮语义由选中项的置顶状态决定；页面内屏蔽浏览器右键菜单。
 */
import { useCallback } from 'react'
import { AppContent, AppFooter, AppHeader, AppPage } from '@webview/components/AppPage'
import { createPressRoute } from './core/routing'
import { useActiveNote } from './hooks/useActiveNote'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotesList } from './hooks/useNotesList'
import { DashboardEntries } from './layout/DashboardEntries'
import { DashboardFooterActions } from './layout/DashboardFooterActions'
import { DashboardSlots } from './layout/DashboardSlots'
import { NotesSection } from './note/NotesSection'
import { NotesSelectionBar } from './note/NotesSelectionBar'
import type { DashboardRoute } from './core/routing'
import type { JSX } from 'react'

interface DashboardProps {
    /** 页内导航：由路由外壳下发，页面不直接改写地址栏 hash */
    onNavigate: (route: DashboardRoute) => void
}

export function Dashboard({ onNavigate }: DashboardProps): JSX.Element {
    const { stats, status, error, reload } = useDashboardStats()
    const {
        pinnedNotes,
        unpinnedNotes,
        isFiltered,
        isSelecting,
        selectedPaths,
        isAllSelectedPinned,
        resetFilters,
        toggleSelecting,
        toggleSelected,
    } = useNotesList(stats)
    const {
        pendingAction,
        createNote,
        openNote,
        setPinned,
        openWorkflow,
        rebuild,
        clearCache,
        openSettings,
        showNotePending,
    } = useDashboardActions(reload)
    const { activeId, setActiveId } = useActiveNote()

    /** 打开笔记：先本地回填选中态避免打开瞬间高亮丢失，随后由宿主按索引路径打开并以活跃编辑器收敛 */
    const handleOpen = useCallback(
        (path: string): void => {
            setActiveId(path)
            void openNote(path)
        },
        [openNote, setActiveId],
    )

    /** 新建空笔记后把返回路径设为选中项 */
    const handleCreate = useCallback(async (): Promise<void> => {
        const created = await createNote()
        if (created !== null) {
            setActiveId(created.path)
        }
    }, [createNote, setActiveId])

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader>
                <DashboardEntries
                    onOpenWriting={() => onNavigate(createPressRoute())}
                    onOpenPress={() => void openWorkflow('wechat')}
                />
            </AppHeader>

            <AppContent isScrollable className="gap-3">
                <DashboardSlots />
                <NotesSection
                    pinnedNotes={pinnedNotes}
                    unpinnedNotes={unpinnedNotes}
                    status={status}
                    error={error}
                    isFiltered={isFiltered}
                    activeId={activeId}
                    isSelecting={isSelecting}
                    selectedPaths={selectedPaths}
                    onSelect={handleOpen}
                    onInvoke={(path, action) => {
                        if (action === 'open') {
                            handleOpen(path)
                            return
                        }
                        if (action === 'pin' || action === 'unpin') {
                            void setPinned([path], action === 'pin')
                            return
                        }
                        showNotePending(action)
                    }}
                    onResetFilters={resetFilters}
                    onToggleSelecting={toggleSelecting}
                    onToggleSelected={toggleSelected}
                />
            </AppContent>

            <AppFooter>
                {isSelecting && selectedPaths.length > 0 ? (
                    <NotesSelectionBar
                        isAllSelectedPinned={isAllSelectedPinned}
                        onTogglePin={() => void setPinned(selectedPaths, !isAllSelectedPinned)}
                        onDelete={() => showNotePending('delete')}
                    />
                ) : (
                    <DashboardFooterActions
                        isBusy={pendingAction !== null}
                        isRebuilding={stats?.isRebuilding === true}
                        onAdd={() => void handleCreate()}
                        onRebuild={() => void rebuild()}
                        onClearCache={() => void clearCache()}
                        onOpenSettings={() => void openSettings()}
                    />
                )}
            </AppFooter>
        </AppPage>
    )
}
