/**
 * 仪表盘概览页：以 AppPage 骨架承载「头部操作 + 入口区 + 笔记本分组列表 + 多选栏」，自身只做组合。
 * 复用约定：外壳取 components/AppPage（头部走 AppHeader、列表走 AppContent 滚动、多选栏走 AppFooter，遮罩由 AppFooter 提供）；
 * 数据与动作经 useDashboardStats / useDashboardActions / useNotebooks / useNoteSelection / useNoteSearch 下发；
 * 笔记操作族收在 useDashboardNoteActions，笔记本弹窗与笔记删除弹窗分别收在 useNotebookDialogs / useNotesDeleteDialog，
 * 弹窗渲染统一由 layout/DashboardDialogs 承担；操作结果统一由 useDashboardActions 经 sonner 反馈，Toaster 由路由外壳挂载。
 * 交互约束：页面上只有一套笔记列表——笔记本分组包住其笔记，笔记不再有跨笔记本的旁路入口；
 * 搜索态切换为扁平结果并禁用笔记本级操作，关键词一变即作废勾选（勾选不得跨列表来源继续生效）；
 * 批量操作栏仅在多选态且有选中项时出现，其按钮语义由选中项的置顶状态决定；
 * 删除（单条、批量或删除整个笔记本）一律先经确认弹窗，笔记只移入应用内回收站，确认结果落定后弹窗才关闭、整单失败保留重试；
 * 删除后指向已消失条目的选中态一律清空；当前选中项以宿主广播的活跃编辑器为准，由 ActiveNoteProvider 统一持有。
 */
import { useCallback, useMemo } from 'react'
import { AppContent, AppFooter, AppHeader, AppPage } from '@webview/components/AppPage'
import { createPressRoute, createTrashRoute, createWechatRoute } from './core/routing'
import { useActiveNote } from './hooks/useActiveNote'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardNoteActions } from './hooks/useDashboardNoteActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotebookDialogs } from './hooks/useNotebookDialogs'
import { useNotebooks } from './hooks/useNotebooks'
import { useNoteQuery } from './hooks/useNoteQuery'
import { useNotesDeleteDialog } from './hooks/useNotesDeleteDialog'
import { useNoteSearch } from './hooks/useNoteSearch'
import { useNoteSelection } from './hooks/useNoteSelection'
import { DashboardDialogs } from './layout/DashboardDialogs'
import { DashboardHeaderActions } from './layout/DashboardHeaderActions'
import { DashboardHeaderEntries } from './layout/DashboardHeaderEntries'
import { DashboardSlots } from './layout/DashboardSlots'
import { NotesSection } from './note/NotesSection'
import { NotesSelectionBar } from './note/NotesSelectionBar'
import { buildTitleByPath, isNoteUnderNotebook } from './note/utils'
import type { DashboardRoute } from './core/routing'
import type { JSX } from 'react'

interface DashboardProps {
    /** 页内导航：由路由外壳下发，页面不直接改写地址栏 hash */
    onNavigate: (route: DashboardRoute) => void
}

export function Dashboard({ onNavigate }: DashboardProps): JSX.Element {
    const { stats, status, error, reload } = useDashboardStats()
    const actions = useDashboardActions(reload)
    /** 笔记本动作单独 memo：useNotebooks 的回调依赖它，避免每帧新建对象导致条目重渲染 */
    const notebookActions = useMemo(
        () => ({ setNotebookSort: actions.setNotebookSort, setNotebookOpen: actions.setNotebookOpen }),
        [actions.setNotebookOpen, actions.setNotebookSort],
    )
    const notebooks = useNotebooks(stats, notebookActions)
    const pinnedPaths = useMemo(
        () => notebooks.allNotes.filter((note) => note.isPinned).map((note) => note.path),
        [notebooks.allNotes],
    )
    const selection = useNoteSelection(pinnedPaths)
    const { activeId, setActiveId } = useActiveNote()
    /** 关键词一变即作废勾选：列表来源在「笔记本分组」与「搜索结果」之间切换，旧勾选对应的条目可能已不可见 */
    const search = useNoteQuery(selection.clearSelection)
    const searchState = useNoteSearch(search.query)

    /** 标题反查：已展开的组内笔记与搜索命中都参与，搜索命中优先，弹窗文案不因快照裁剪而落成裸路径 */
    const titleByPath = useMemo(
        () => buildTitleByPath(notebooks.allNotes, searchState.results),
        [notebooks.allNotes, searchState.results],
    )
    const resolveDeleteTitles = useCallback(
        (paths: readonly string[]): string[] => paths.map((path) => titleByPath.get(path) ?? ''),
        [titleByPath],
    )

    /** 删除成功后的收尾：当前打开的被删掉则清空选中态，批量删除后退出多选，避免残留已不存在的路径 */
    const handleNotesDeleted = useCallback(
        (trashedPaths: readonly string[]): void => {
            const removed = new Set(trashedPaths)
            if (activeId !== null && removed.has(activeId)) {
                setActiveId(null)
            }
            if (selection.isSelecting) {
                selection.toggleSelecting()
            }
        },
        [activeId, selection, setActiveId],
    )

    const notesDelete = useNotesDeleteDialog({
        isSubmitting: actions.isPending('delete'),
        resolveTitles: resolveDeleteTitles,
        deleteNotes: actions.deleteNotes,
        onDeleted: handleNotesDeleted,
    })

    /** 笔记本删除后的收尾：其笔记已全部移入回收站，当前打开的若是其一则清空选中态 */
    const handleNotebookDeleted = useCallback(
        (notebookId: string): void => {
            if (activeId !== null && isNoteUnderNotebook(activeId, notebookId)) {
                setActiveId(null)
            }
        },
        [activeId, setActiveId],
    )

    const notebookDialogs = useNotebookDialogs({
        isCreating: actions.isPending('notebook-create'),
        isRenaming: actions.isPending('notebook-rename'),
        isDeleting: actions.isPending('notebook-delete'),
        createNotebook: actions.createNotebook,
        renameNotebook: actions.renameNotebook,
        deleteNotebook: actions.deleteNotebook,
        onDeleted: handleNotebookDeleted,
    })

    const noteActions = useDashboardNoteActions({
        openNote: actions.openNote,
        createNote: actions.createNote,
        setPinned: actions.setPinned,
        setActiveId,
        isNotebookOpen: notebooks.isOpen,
        toggleNotebookOpen: notebooks.toggleOpen,
        requestDelete: notesDelete.requestDelete,
    })

    /** 有操作在途时禁用所有入口按钮，避免重复触发 */
    const isBusy = actions.pendingAction !== null

    return (
        <AppPage>
            <AppHeader>
                <DashboardHeaderActions isBusy={isBusy} search={search} onCreate={() => void noteActions.create()} />
                <DashboardHeaderEntries
                    onOpenWriting={() => onNavigate(createPressRoute())}
                    onOpenPress={() => onNavigate(createWechatRoute())}
                />
            </AppHeader>

            <AppContent isScrollable className="gap-3">
                <DashboardSlots />
                <NotesSection
                    notebooks={notebooks.notebooks}
                    sort={notebooks.sort}
                    isOpen={notebooks.isOpen}
                    notesOf={notebooks.notesOf}
                    status={status}
                    error={error}
                    query={search.query}
                    searchResults={searchState.results}
                    isSearching={searchState.isSearching}
                    searchError={searchState.error}
                    activeId={activeId}
                    isSelecting={selection.isSelecting}
                    selectedPaths={selection.selectedPaths}
                    isBusy={isBusy}
                    onToggleOpen={notebooks.toggleOpen}
                    onChangeSort={notebooks.changeSort}
                    onCollapseAll={notebooks.collapseAll}
                    onCreateNotebook={notebookDialogs.openCreate}
                    onOpenTrash={() => onNavigate(createTrashRoute())}
                    onAddNote={(id) => void noteActions.create(id)}
                    onRenameNotebook={notebookDialogs.openRename}
                    onToggleNotebookPin={(notebook) => void actions.pinNotebooks([notebook.id], !notebook.isPinned)}
                    onDeleteNotebook={notebookDialogs.openDelete}
                    onSelect={noteActions.open}
                    onInvoke={noteActions.invoke}
                    onToggleSelecting={selection.toggleSelecting}
                    onToggleSelected={selection.toggleSelected}
                    onClearQuery={search.clear}
                />
            </AppContent>

            {selection.isSelecting && selection.selectedPaths.length > 0 ? (
                <AppFooter className="pt-2">
                    <NotesSelectionBar
                        isAllSelectedPinned={selection.isAllSelectedPinned}
                        isBusy={isBusy}
                        onTogglePin={() =>
                            void actions.setPinned(selection.selectedPaths, !selection.isAllSelectedPinned)
                        }
                        onDelete={() => notesDelete.requestDelete(selection.selectedPaths)}
                    />
                </AppFooter>
            ) : null}

            <DashboardDialogs notes={notesDelete} notebook={notebookDialogs} />
        </AppPage>
    )
}
