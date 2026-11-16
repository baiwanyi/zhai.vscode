/**
 * 仪表盘概览页：以 AppPage 骨架承载「头部操作 + 入口区 + 笔记本分组列表 + 多选栏」。
 * 复用约定：外壳取 components/AppPage（头部操作与入口区走 AppHeader、列表走 AppContent 滚动、多选栏走 AppFooter），
 * 底栏上方的渐变遮罩由 AppFooter 统一提供，页面不再自行声明。
 * 头部首行常驻搜索输入框与「添加笔记」按钮（由 layout/DashboardHeaderActions 承载），回收站入口收在笔记区块的「更多」下拉内；
 * 索引重建、缓存清理与插件设置收在 VS Code 标题栏的「…」下拉里（view/title 的 9_zhai 分组），页内不再自绘浮层。
 * 数据与动作经 useDashboardStats / useDashboardActions / useNotebooks / useNoteSelection / useNoteSearch 下发，页面只做组合；
 * 操作结果统一由 useDashboardActions 经 sonner 反馈，Toaster 由路由外壳 dashboardScreen 统一挂载。
 * 交互约束：页面上只有一套笔记列表——笔记本分组包住其笔记，笔记不再有跨笔记本的旁路入口；
 * 搜索态切换为扁平结果并禁用笔记本级操作；批量操作栏仅在多选态且有选中项时出现，其按钮语义由选中项的置顶状态决定；
 * 删除（单条、批量或删除整个笔记本）一律先经确认弹窗，笔记只移入应用内回收站，彻底清除在回收站页完成；
 * 当前选中项以宿主广播的活跃编辑器为准（点击时先本地回填，关闭笔记后随焦点回退自动切回上一篇），
 * 该选中态由 ActiveNoteProvider 统一持有，页面不再自建副本。
 */
import { useCallback, useMemo, useState } from 'react'
import type { NoteAction } from '@shared/types/dashboard'
import type { NotebookSummary } from '@shared/types/notebook'
import { AppContent, AppFooter, AppHeader, AppPage } from '@webview/components/AppPage'
import { createPressRoute, createTrashRoute, createWechatRoute } from './core/routing'
import { useActiveNote } from './hooks/useActiveNote'
import { useConfirmAction } from './hooks/useConfirmAction'
import { useDashboardActions } from './hooks/useDashboardActions'
import { useDashboardStats } from './hooks/useDashboardStats'
import { useNotebooks } from './hooks/useNotebooks'
import { useNoteQuery } from './hooks/useNoteQuery'
import { useNoteSearch } from './hooks/useNoteSearch'
import { useNoteSelection } from './hooks/useNoteSelection'
import { DashboardHeaderActions } from './layout/DashboardHeaderActions'
import { DashboardHeaderEntries } from './layout/DashboardHeaderEntries'
import { DashboardSlots } from './layout/DashboardSlots'
import { NotebookDeleteDialog } from './note/NotebookDeleteDialog'
import { NotebookNameDialog } from './note/NotebookNameDialog'
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
    const search = useNoteQuery()
    const searchState = useNoteSearch(search.query)
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
    /** 待删除的笔记路径集合：空集合即弹窗关闭，单条删除即长度为 1 的集合 */
    const [deletePaths, setDeletePaths] = useState<string[]>([])
    const deleteConfirm = useConfirmAction({ close: () => setDeletePaths([]) })
    /** 新建笔记本弹窗的 key：每次打开自增，让输入框回到空值 */
    const [createDialogKey, setCreateDialogKey] = useState(0)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [renameTarget, setRenameTarget] = useState<NotebookSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<NotebookSummary | null>(null)

    /** 标题反查：已展开的组内笔记与搜索命中都参与，弹窗文案不因快照裁剪而落成裸路径 */
    const titleByPath = useMemo(() => {
        const map = new Map<string, string>()
        for (const note of notebooks.allNotes) {
            map.set(note.path, note.title)
        }
        for (const note of searchState.results) {
            map.set(note.path, note.title)
        }
        return map
    }, [notebooks.allNotes, searchState.results])

    const deleteTitles = useMemo(
        () => deletePaths.map((path) => titleByPath.get(path) ?? path),
        [deletePaths, titleByPath],
    )

    /** 打开笔记：先本地回填选中态避免打开瞬间高亮丢失，随后由宿主按索引路径打开并以活跃编辑器收敛 */
    const handleOpen = useCallback(
        (path: string): void => {
            setActiveId(path)
            void actions.openNote(path)
        },
        [actions, setActiveId],
    )

    /** 新建笔记：默认落点由宿主决定；指定笔记本时顺带展开该组，让新笔记立刻可见 */
    const handleCreateNote = useCallback(
        async (notebookId?: string): Promise<void> => {
            const created = await actions.createNote(notebookId)
            if (created === null) {
                return
            }
            setActiveId(created.path)
            if (notebookId !== undefined && !notebooks.isOpen(notebookId)) {
                notebooks.toggleOpen(notebookId)
            }
        },
        [actions, notebooks, setActiveId],
    )

    /**
     * 确认删除：结果落定后才清空待处理集合让弹窗退场，时序由 useConfirmAction 承担。
     * 整单异常或全部失败时任务返回 false，待处理项保留供原地重试或取消；
     * 结果提示由数据层统一发出；删除成功的条目若正是当前选中笔记则清空选中态，
     * 批量删除后退出多选，避免选中集合残留已不存在的路径。
     */
    const handleConfirmDelete = useCallback((): void => {
        const targets = deletePaths
        deleteConfirm.confirm(async () => {
            const result = await actions.deleteNotes(targets)
            if (result === null || result.trashedPaths.length === 0) {
                return false
            }
            const removed = new Set(result.trashedPaths)
            if (activeId !== null && removed.has(activeId)) {
                setActiveId(null)
            }
            if (selection.isSelecting) {
                selection.toggleSelecting()
            }
            return true
        })
    }, [actions, activeId, deleteConfirm, deletePaths, selection, setActiveId])

    /** 笔记条目上的操作：打开、置顶切换、删除入回收站 */
    const handleInvokeNote = useCallback(
        (path: string, action: NoteAction): void => {
            if (action === 'open') {
                handleOpen(path)
                return
            }
            if (action === 'pin' || action === 'unpin') {
                void actions.setPinned([path], action === 'pin')
                return
            }
            // 删除须二次确认：先把条目送入弹窗，确认后才提交宿主
            setDeletePaths([path])
        },
        [actions, handleOpen],
    )

    const handleOpenCreateDialog = useCallback((): void => {
        setCreateDialogKey((previous) => previous + 1)
        setIsCreateOpen(true)
    }, [])

    const handleConfirmDeleteNotebook = useCallback((): void => {
        const target = deleteTarget
        setDeleteTarget(null)
        if (target !== null) {
            void actions.deleteNotebook(target.id)
        }
    }, [actions, deleteTarget])

    const handleRenameSubmit = useCallback(
        async (name: string): Promise<boolean> => {
            if (renameTarget === null) {
                return false
            }
            return actions.renameNotebook(renameTarget.id, name)
        },
        [actions, renameTarget],
    )

    const handleCreateSubmit = useCallback((name: string): Promise<boolean> => actions.createNotebook(name), [actions])

    /** 有操作在途时禁用所有入口按钮，避免重复触发 */
    const isBusy = actions.pendingAction !== null

    return (
        <AppPage>
            <AppHeader>
                <DashboardHeaderActions isBusy={isBusy} search={search} onCreate={() => void handleCreateNote()} />
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
                    onCreateNotebook={handleOpenCreateDialog}
                    onOpenTrash={() => onNavigate(createTrashRoute())}
                    onAddNote={(id) => void handleCreateNote(id)}
                    onRenameNotebook={setRenameTarget}
                    onToggleNotebookPin={(notebook) => void actions.pinNotebooks([notebook.id], !notebook.isPinned)}
                    onDeleteNotebook={setDeleteTarget}
                    onSelect={handleOpen}
                    onInvoke={handleInvokeNote}
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
                        onDelete={() => setDeletePaths(selection.selectedPaths)}
                    />
                </AppFooter>
            ) : null}

            {deletePaths.length > 0 ? (
                <NotesDeleteDialog
                    open
                    titles={deleteTitles}
                    isSubmitting={actions.pendingAction === 'delete'}
                    onOpenChange={deleteConfirm.onOpenChange}
                    onConfirm={handleConfirmDelete}
                />
            ) : null}

            {isCreateOpen ? (
                <NotebookNameDialog
                    key={createDialogKey}
                    open
                    mode="create"
                    isSubmitting={actions.pendingAction === 'notebook-create'}
                    onOpenChange={setIsCreateOpen}
                    onSubmit={handleCreateSubmit}
                />
            ) : null}

            {renameTarget !== null ? (
                <NotebookNameDialog
                    key={renameTarget.id}
                    open
                    mode="rename"
                    initialName={renameTarget.name}
                    isSubmitting={actions.pendingAction === 'notebook-rename'}
                    onOpenChange={(isOpen) => {
                        if (!isOpen) {
                            setRenameTarget(null)
                        }
                    }}
                    onSubmit={handleRenameSubmit}
                />
            ) : null}

            {deleteTarget !== null ? (
                <NotebookDeleteDialog
                    open
                    notebookName={deleteTarget.name}
                    noteCount={deleteTarget.noteCount}
                    isSubmitting={actions.pendingAction === 'notebook-delete'}
                    onOpenChange={(isOpen) => {
                        if (!isOpen) {
                            setDeleteTarget(null)
                        }
                    }}
                    onConfirm={handleConfirmDeleteNotebook}
                />
            ) : null}
        </AppPage>
    )
}
