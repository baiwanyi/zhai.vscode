/**
 * 待办列表模块：仪表盘概览区的待办卡片，替换原「模块分布」占位槽位，不单独成页。
 * 复用约定：数据与写操作交给 ../todo/useTodoLists，清单行、条目与输入区复用 ../todo 下的组件，
 * 卡片取 @components/ui 的 card，折叠语义取 collapsible，空态取 empty，统计用 badge，弹窗走既有组件。
 * 关键约束：标题行整行可点，折叠后只保留「待办列表 + 未完成数」；清单的增删改都收进 TodoListBar 的下拉；
 * 删除与重命名共用一个弹窗状态（同一时刻只会打开一个），关闭即清空，避免旧清单名残留在弹窗里；
 * 列表按固定最大高度内部滚动，提交中禁用开关与发布。文件内的 Header / Empty 为私有展示组件，不对外导出。
 */
'use client'

import { cn } from 'cn'
import { ChevronRight } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Card, CardContent } from '@components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@components/ui/empty'
import { ScrollArea } from '@components/ui/scroll-area'
import { Spinner } from '@components/ui/spinner'
import type { TodoListSummary } from '@shared/types/todo'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import type { JSX, ReactNode } from 'react'
import { TodoComposer } from './TodoComposer'
import { TodoItemRow } from './TodoItemRow'
import { TodoListBar } from './TodoListBar'
import { TodoListRenameDialog } from './TodoListRenameDialog'
import { useTodoLists } from './useTodoLists'

/** 当前打开的弹窗：删除与重命名共用一份状态，二者互斥 */
type TodoDialog = { kind: 'delete'; list: TodoListSummary } | { kind: 'rename'; list: TodoListSummary }

export function DashboardTodo(): JSX.Element {
    const {
        lists,
        activeListId,
        items,
        status,
        activeIndex,
        createList,
        selectList,
        deleteList,
        renameList,
        addItems,
        toggleItem,
        deleteItem,
        setActiveIndex,
    } = useTodoLists()
    const [isOpen, setIsOpen] = useState(true)
    const [dialog, setDialog] = useState<TodoDialog | null>(null)
    const endRef = useRef<HTMLDivElement>(null)
    const isBusy = status !== 'ready'
    const activeList = lists.find((list) => list.id === activeListId)
    const pendingCount = (activeList?.totalCount ?? 0) - (activeList?.doneCount ?? 0)

    const handleCreate = useCallback((): void => {
        void createList()
    }, [createList])

    const handleSelect = useCallback(
        (listId: string): void => {
            void selectList(listId)
        },
        [selectList],
    )

    const closeDialog = useCallback((): void => {
        setDialog(null)
    }, [])

    const handleRequestDelete = useCallback((list: TodoListSummary): void => {
        setDialog({ kind: 'delete', list })
    }, [])

    const handleRequestRename = useCallback((list: TodoListSummary): void => {
        setDialog({ kind: 'rename', list })
    }, [])

    /** 删除先关闭弹窗再落盘：确认框不等待请求，失败提示与重读由 useTodoLists 统一处理 */
    const handleConfirmDelete = useCallback((): void => {
        if (dialog?.kind === 'delete') {
            void deleteList(dialog.list.id)
        }
        closeDialog()
    }, [closeDialog, deleteList, dialog])

    /** 新增成功后把列表末尾滚入视野：卡片内的滚动区不会自动跟随 */
    const handleSubmit = useCallback(
        async (texts: string[]): Promise<boolean> => {
            const isSuccess = await addItems(texts)
            if (isSuccess) {
                endRef.current?.scrollIntoView({ block: 'nearest' })
            }
            return isSuccess
        },
        [addItems],
    )

    return (
        <>
            <Card size="sm" className={cn('gap-0 py-0!', isOpen && 'min-h-28')}>
                <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex flex-col">
                    <TodoHeader pendingCount={pendingCount} />
                    <CollapsibleContent>
                        <CardContent className="flex flex-col gap-2 pb-3">
                            <TodoListBar
                                lists={lists}
                                activeListId={activeListId}
                                isDisabled={isBusy}
                                onSelect={handleSelect}
                                onCreate={handleCreate}
                                onRename={handleRequestRename}
                                onDelete={handleRequestDelete}
                            />
                            {status === 'loading' ? <TodoEmpty isLoading description="正在读取待办…" /> : null}
                            {status !== 'loading' && lists.length === 0 ? (
                                <TodoEmpty
                                    description="还没有待办清单"
                                    action={
                                        <Button size="sm" variant="outline" onClick={handleCreate}>
                                            新建清单
                                        </Button>
                                    }
                                />
                            ) : null}
                            {status !== 'loading' && lists.length > 0 && items.length === 0 ? (
                                <TodoEmpty description="这份清单还没有待办，下方输入后回车即可添加" />
                            ) : null}
                            {items.length > 0 ? (
                                <ScrollArea className="max-h-44">
                                    <div className="flex flex-col gap-1.5 pr-1">
                                        {items.map((item) => (
                                            <TodoItemRow
                                                key={`${String(item.index)}-${item.text}`}
                                                item={item}
                                                isActive={activeIndex === item.index}
                                                isDisabled={isBusy}
                                                onToggle={toggleItem}
                                                onDelete={deleteItem}
                                                onActivate={setActiveIndex}
                                            />
                                        ))}
                                        <div ref={endRef} />
                                    </div>
                                </ScrollArea>
                            ) : null}
                            <TodoComposer isDisabled={isBusy} onSubmit={handleSubmit} />
                        </CardContent>
                    </CollapsibleContent>
                </Collapsible>
            </Card>
            <ConfirmDialog
                open={dialog?.kind === 'delete'}
                title={`删除「${dialog?.kind === 'delete' ? dialog.list.name : ''}」？`}
                description="清单文件将移入系统回收站，其中的待办不再显示。"
                confirmLabel="删除"
                isDestructive
                isSubmitting={status === 'mutating'}
                onOpenChange={(isOpenNow) => {
                    if (!isOpenNow) {
                        closeDialog()
                    }
                }}
                onConfirm={handleConfirmDelete}
            />
            {dialog?.kind === 'rename' ? (
                <TodoListRenameDialog
                    key={dialog.list.id}
                    open
                    initialName={dialog.list.name}
                    isSubmitting={status === 'mutating'}
                    onOpenChange={(isOpenNow) => {
                        if (!isOpenNow) {
                            closeDialog()
                        }
                    }}
                    onSubmit={renameList}
                />
            ) : null}
        </>
    )
}

/** 折叠头：整行为触发区，右侧固定未完成数与方向箭头 */
function TodoHeader({ pendingCount }: { pendingCount: number }): JSX.Element {
    return (
        <CollapsibleTrigger asChild>
            <Button
                variant="ghost"
                className="group/todo h-auto! w-full justify-between gap-2 rounded-none px-3! py-2 aria-expanded:bg-transparent"
            >
                <span className="truncate text-sm font-medium">待办列表</span>
                <span className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="font-light">
                        {pendingCount} 条待办
                    </Badge>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]/todo:rotate-90" />
                </span>
            </Button>
        </CollapsibleTrigger>
    )
}

interface TodoEmptyProps {
    description: string
    /** 读取中：用旋转指示替代图标，文案由调用方给出 */
    isLoading?: boolean
    /** 空态里的补充操作，例如「新建清单」 */
    action?: ReactNode
}

/** 空态与加载态的统一外观：三处共用同一套边框与内边距，避免样式各自漂移 */
function TodoEmpty({ description, isLoading = false, action }: TodoEmptyProps): JSX.Element {
    return (
        <Empty className="border px-3 py-4">
            <EmptyHeader>
                {isLoading ? (
                    <EmptyMedia variant="icon">
                        <Spinner aria-label={description} />
                    </EmptyMedia>
                ) : null}
                <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
            {action !== undefined ? <EmptyContent>{action}</EmptyContent> : null}
        </Empty>
    )
}
