/**
 * 仪表盘概览页：顶部操作区固定，滚动区依次呈现概览槽位、功能入口与笔记列表，多选操作栏贴底；
 * 滚动区顶部叠一层由背景色到透明的渐变遮罩，使内容逼近固定操作区时淡出，避免硬切。
 * 数据与动作经 useDashboardStats / useNotesList / useDashboardActions 三层 hook 下发，页面只做组合；
 * 操作结果统一由 useDashboardActions 经 sonner 反馈，Toaster 由路由外壳 dashboardScreen 统一挂载。
 * 交互约束：写作管理入口改为页内路由跳转（由路由外壳下发的 onNavigate 承担），公众号管理仍走工作流面板；
 * 重建索引期间由统计 hook 轮询收敛按钮态；选中条目即按 path 打开笔记，
 * 当前选中项以宿主广播的活跃编辑器为准（点击时先本地回填，关闭笔记后随焦点回退自动切回上一篇）；
 * 批量操作栏仅在多选态且有选中项时出现，其按钮语义由选中项的置顶状态决定；页面内屏蔽浏览器右键菜单。
 */
import { useCallback } from 'react'
import { ScrollArea } from '@components/ui/scroll-area'
import { createPressRoute } from './core/routing'
import { useActiveNote } from './hooks/useActiveNote'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotesList } from './hooks/useNotesList'
import { DashboardEntries } from './layout/DashboardEntries'
import { DashboardSlots } from './layout/DashboardSlots'
import { DashboardTopBar } from './layout/DashboardTopBar'
import { NotesSection } from './layout/NotesSection'
import { NotesSelectionBar } from './layout/NotesSelectionBar'
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
        <div className="@container flex h-screen min-h-0 flex-col" onContextMenu={(event) => event.preventDefault()}>
            <header className="p-3">
                <DashboardTopBar
                    isBusy={pendingAction !== null}
                    isRebuilding={stats?.isRebuilding === true}
                    onAdd={() => void handleCreate()}
                    onRebuild={() => void rebuild()}
                    onClearCache={() => void clearCache()}
                    onOpenSettings={() => void openSettings()}
                />
            </header>

            <ScrollArea className="min-h-0 flex-1 px-3">
                <div className="flex flex-col gap-3 p-0.5">
                    <DashboardSlots />
                    <DashboardEntries
                        onOpenWriting={() => onNavigate(createPressRoute())}
                        onOpenPress={() => void openWorkflow('wechat')}
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
                        onToggleModule={toggleModule}
                        onResetFilters={resetFilters}
                        onToggleSelecting={toggleSelecting}
                        onToggleSelected={toggleSelected}
                    />
                </div>
            </ScrollArea>

            <footer className="relative flex shrink-0 items-center justify-end gap-1.5 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent">
                {isSelecting && selectedPaths.length > 0 ? (
                    <NotesSelectionBar
                        isAllSelectedPinned={isAllSelectedPinned}
                        onTogglePin={() => void setPinned(selectedPaths, !isAllSelectedPinned)}
                        onDelete={() => showNotePending('delete')}
                    />
                ) : null}
            </footer>
        </div>
    )
}
