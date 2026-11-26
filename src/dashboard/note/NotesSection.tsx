/**
 * 笔记区块：卡片内组合标题行操作、笔记本分组列表与搜索结果的扁平列表，自身不取数、不持有筛选状态。
 * 数据与展开状态经页面 useNotebooks / useNoteSearch 下发；加载与失败态统一由 NotesListState 呈现。
 * 关键约束：页面上只有这一套笔记列表，笔记只出现在其所属笔记本分组内，不再有跨笔记本的最近更新旁路；
 * 搜索态整体切换为扁平结果并禁用笔记本级操作；
 * 多选沿用当前展开集合而不强制全部展开——折叠中的笔记看不见也就选不到，不会出现「选中了却看不见」；
 * 标题行操作置于 CardAction 槽位以对齐卡片头部网格。
 */
import { FileSearch, NotebookPen, Notebook, Plus } from 'lucide-react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import type { NoteAction, RecentFile } from '@shared/types/dashboard'
import type { NotebookSort, NotebookSummary } from '@shared/types/notebook'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { NotebookList } from './NotebookList'
import { NotesHeaderActions } from './NotesHeaderActions'
import { NotesListItem } from './NotesListItem'
import { NotesListState } from './NotesListState'
import type { StatsStatus } from '../hooks/useDashboardStats'
import type { NotebookNotesEntry } from './types'
import type { JSX } from 'react'

interface NotesSectionProps {
    notebooks: NotebookSummary[]
    sort: NotebookSort
    isOpen: (id: string) => boolean
    notesOf: (id: string) => NotebookNotesEntry | null
    status: StatsStatus
    error: string | null
    /** 当前搜索关键词，非空即进入搜索态 */
    query: string
    searchResults: RecentFile[]
    isSearching: boolean
    searchError: string | null
    activeId: string | null
    isSelecting: boolean
    selectedPaths: string[]
    /** 有操作在途时禁用笔记本级操作，避免重复提交 */
    isBusy: boolean
    onToggleOpen: (id: string) => void
    onChangeSort: (sort: NotebookSort) => void
    onCollapseAll: () => void
    onCreateNotebook: () => void
    /** 打开回收站页：入口在标题行的「更多」下拉内 */
    onOpenTrash: () => void
    onAddNote: (id: string) => void
    onRenameNotebook: (notebook: NotebookSummary) => void
    onToggleNotebookPin: (notebook: NotebookSummary) => void
    onDeleteNotebook: (notebook: NotebookSummary) => void
    onSelect: (path: string) => void
    onInvoke: (path: string, action: NoteAction) => void
    onToggleSelecting: () => void
    onToggleSelected: (path: string) => void
    onClearQuery: () => void
}

export function NotesSection({
    notebooks,
    sort,
    isOpen,
    notesOf,
    status,
    error,
    query,
    searchResults,
    isSearching,
    searchError,
    activeId,
    isSelecting,
    selectedPaths,
    isBusy,
    onToggleOpen,
    onChangeSort,
    onCollapseAll,
    onCreateNotebook,
    onOpenTrash,
    onAddNote,
    onRenameNotebook,
    onToggleNotebookPin,
    onDeleteNotebook,
    onSelect,
    onInvoke,
    onToggleSelecting,
    onToggleSelected,
    onClearQuery,
}: NotesSectionProps): JSX.Element {
    const isSearchMode = query.trim().length > 0
    const selectedCount = selectedPaths.length

    const title = ((): string => {
        if (isSelecting) {
            return selectedCount > 0 ? `已选择 ${String(selectedCount)} 个笔记` : '选择笔记'
        }
        if (isSearchMode) {
            return isSearching ? '搜索中…' : `搜索「${query.trim()}」`
        }
        return '笔记'
    })()

    const renderSearchResults = (): JSX.Element => {
        // 重试期间 isSearching 为真：旧错误先让位给「搜索中」，避免改词后界面像没反应
        if (searchError !== null && !isSearching) {
            return <NotesListState status="error" error={searchError} isFiltered onResetFilters={onClearQuery} />
        }
        if (searchResults.length === 0) {
            return (
                <Empty
                    title={isSearching ? '搜索中…' : '没有匹配的笔记'}
                    description={isSearching ? undefined : '换个关键词，或清除搜索查看全部笔记本。'}
                    icon={FileSearch}
                    isLoading={isSearching}
                    className="border px-3 py-4"
                >
                    {isSearching ? null : (
                        <Button variant="outline" onClick={onClearQuery}>
                            清除搜索
                        </Button>
                    )}
                </Empty>
            )
        }
        return (
            <ItemGroup className="has-data-[size=xs]:gap-0 has-data-[size=sm]:gap-0">
                {searchResults.map((note) => (
                    <NotesListItem
                        key={note.path}
                        note={note}
                        isActive={!isSelecting && note.path === activeId}
                        isSelecting={isSelecting}
                        isSelected={selectedPaths.includes(note.path)}
                        onSelect={() => onSelect(note.path)}
                        onInvoke={(action) => onInvoke(note.path, action)}
                        onToggleSelected={() => onToggleSelected(note.path)}
                    />
                ))}
            </ItemGroup>
        )
    }

    const renderContent = (): JSX.Element => {
        if (status !== 'ready') {
            return <NotesListState status={status} error={error} isFiltered={false} onResetFilters={onClearQuery} />
        }
        if (isSearchMode) {
            return renderSearchResults()
        }
        if (notebooks.length === 0) {
            return (
                <Empty
                    title="还没有笔记本"
                    description="新建一个笔记本后即可在里面写笔记，未指定时笔记会落在「未分类」。"
                    icon={Notebook}
                    className="border px-3 py-4"
                >
                    <Button variant="outline" onClick={onCreateNotebook}>
                        <Plus className="size-4" />
                        新建笔记本
                    </Button>
                </Empty>
            )
        }
        return (
            <NotebookList
                notebooks={notebooks}
                isOpen={isOpen}
                notesOf={notesOf}
                activeId={activeId}
                isSelecting={isSelecting}
                selectedPaths={selectedPaths}
                onToggleOpen={onToggleOpen}
                onAddNote={onAddNote}
                onRename={onRenameNotebook}
                onTogglePin={onToggleNotebookPin}
                onDelete={onDeleteNotebook}
                onOpenNote={onSelect}
                onInvokeNote={onInvoke}
                onToggleSelected={onToggleSelected}
            />
        )
    }

    return (
        <Card size="sm" className="ring-0">
            <CardHeader className="relative min-h-8 items-center px-0">
                <CardTitle className="flex min-w-0 items-center gap-1">
                    <NotebookPen className="size-4 shrink-0" />
                    <span className="truncate">{title}</span>
                </CardTitle>
                <CardAction className="row-span-1">
                    <NotesHeaderActions
                        isSelecting={isSelecting}
                        onToggleSelecting={onToggleSelecting}
                        sort={sort}
                        onChangeSort={onChangeSort}
                        onCollapseAll={onCollapseAll}
                        onCreateNotebook={onCreateNotebook}
                        onOpenTrash={onOpenTrash}
                        isDisabled={isBusy || isSearchMode}
                    />
                </CardAction>
            </CardHeader>
            <CardContent className="px-0">{renderContent()}</CardContent>
        </Card>
    )
}
