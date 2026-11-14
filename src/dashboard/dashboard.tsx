/**
 * 仪表盘概览页：以 AppPage 骨架承载「入口区 + 笔记滚动区 + 贴底操作栏」三段。
 * 复用约定：外壳取 components/AppPage（入口区走 AppHeader、概览与列表走 AppContent 滚动、底部操作栏与多选栏走 AppFooter），
 * 底栏上方的渐变遮罩由 AppFooter 统一提供，页面不再自行声明。
 * 数据与动作经 useDashboardStats / useNotesList / useDashboardActions 三层 hook 下发，页面只做组合；
 * 操作结果统一由 useDashboardActions 经 sonner 反馈，Toaster 由路由外壳 dashboardScreen 统一挂载。
 * 交互约束：写作管理与公众号管理入口均为页内路由跳转（由路由外壳下发的 onNavigate 承担），
 * 公众号的运营功能仍落在工作流面板的专属分区，待办事项以模块卡片嵌在概览区（不单独成页）；
 * 重建索引期间由统计 hook 轮询收敛按钮态；选中条目即按 path 打开笔记，
 * 当前选中项以宿主广播的活跃编辑器为准（点击时先本地回填，关闭笔记后随焦点回退自动切回上一篇），
 * 该选中态由 ActiveNoteProvider 统一持有，与路由外壳的归属判断共享同一份，页面不再自建副本；
 * 批量操作栏仅在多选态且有选中项时出现，其按钮语义由选中项的置顶状态决定；页面内屏蔽浏览器右键菜单；
 * 删除（单条或批量）一律先经确认弹窗，待删除路径集合即弹窗开关，确认后清空集合让弹窗立即关闭，
 * 删除成功的条目若正是当前选中笔记则清空选中态，批量删除后退出多选，列表随统计刷新自然回落到空态。
 */
import { useCallback, useMemo, useState } from 'react'
import { AppContent, AppFooter, AppHeader, AppPage } from '@webview/components/AppPage'
import { createPressRoute, createWechatRoute } from './core/routing'
import { useActiveNote } from './hooks/useActiveNote'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotesList } from './hooks/useNotesList'
import { DashboardEntries } from './layout/DashboardEntries'
import { DashboardFooterActions } from './layout/DashboardFooterActions'
import { DashboardSlots } from './layout/DashboardSlots'
import { NotesDeleteDialog } from './note/NotesDeleteDialog'
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
        search,
        isSelecting,
        selectedPaths,
        isAllSelectedPinned,
        resetFilters,
        toggleSelecting,
        toggleSelected,
    } = useNotesList(stats)
    const { pendingAction, createNote, openNote, setPinned, deleteNotes, rebuild, clearCache, openSettings } =
        useDashboardActions(reload)
    const { activeId, setActiveId } = useActiveNote()
    /** 待删除的笔记路径集合：空集合即弹窗关闭，单条删除即长度为 1 的集合 */
    const [deletePaths, setDeletePaths] = useState<string[]>([])
    /** 弹窗标题取自列表快照，快照里找不到时回落到路径，避免删到一半列表已刷新而标题为空 */
    const deleteTitles = useMemo(() => {
        const titleByPath = new Map((stats?.recentFiles ?? []).map((file) => [file.path, file.title]))
        return deletePaths.map((path) => titleByPath.get(path) ?? path)
    }, [deletePaths, stats])

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

    /**
     * 确认删除：先清空待处理集合让弹窗立即关闭，再按路径提交删除。
     * 结果提示由数据层统一发出；删除成功的条目若正是当前选中笔记则清空选中态，
     * 批量删除后退出多选，避免选中集合残留已不存在的路径。
     */
    const handleConfirmDelete = useCallback((): void => {
        const targets = deletePaths
        setDeletePaths([])
        void deleteNotes(targets).then((result) => {
            if (result === null || result.deletedPaths.length === 0) {
                return
            }
            const removed = new Set(result.deletedPaths)
            if (activeId !== null && removed.has(activeId)) {
                setActiveId(null)
            }
            if (isSelecting) {
                toggleSelecting()
            }
        })
    }, [activeId, deleteNotes, deletePaths, isSelecting, setActiveId, toggleSelecting])

    /** 取消删除：仅关闭弹窗，不触达宿主 */
    const handleDeleteOpenChange = useCallback((isOpen: boolean): void => {
        if (!isOpen) {
            setDeletePaths([])
        }
    }, [])

    return (
        <AppPage>
            <AppHeader>
                <DashboardEntries
                    onOpenWriting={() => onNavigate(createPressRoute())}
                    onOpenPress={() => onNavigate(createWechatRoute())}
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
                    search={search}
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
                        // 删除须二次确认：先把条目送入弹窗，确认后才提交宿主
                        setDeletePaths([path])
                    }}
                    onResetFilters={resetFilters}
                    onToggleSelecting={toggleSelecting}
                    onToggleSelected={toggleSelected}
                />
            </AppContent>

            <AppFooter className="justify-between pt-2">
                {isSelecting && selectedPaths.length > 0 ? (
                    <NotesSelectionBar
                        isAllSelectedPinned={isAllSelectedPinned}
                        onTogglePin={() => void setPinned(selectedPaths, !isAllSelectedPinned)}
                        onDelete={() => setDeletePaths(selectedPaths)}
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

            {deletePaths.length > 0 ? (
                <NotesDeleteDialog
                    open
                    titles={deleteTitles}
                    isSubmitting={pendingAction === 'delete'}
                    onOpenChange={handleDeleteOpenChange}
                    onConfirm={handleConfirmDelete}
                />
            ) : null}
        </AppPage>
    )
}
