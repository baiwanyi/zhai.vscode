/**
 * 笔记区块标题行操作：笔记本级操作（新建、收起全部、排序）与回收站入口收进一个「更多」下拉，多选开关独立成按钮。
 * 复用 @webview/components/Button 承载图标入口（悬停提示由该组件提供），菜单取 @components/ui/dropdown-menu。
 * 关键约束：排序用菜单内单选组表达当前生效方式，切换即落库，不做二次确认；
 * 全部笔记本级动作共用一个触发按钮，避免标题行在侧栏窄宽度下被图标按钮挤满；
 * 多选是模式开关而非笔记本操作，保持独立按钮；多选态隐藏以上全部入口，只渲染退出按钮；
 * 回收站是页面级导航，但入口随「更多」下拉收纳，页头首行只留搜索框与「添加笔记」。
 */
import { Archive, BookPlus, ListChecks, ListChevronsDownUp, MoreHorizontal, X } from 'lucide-react'
import { useId } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { isNotebookSort, type NotebookSort } from '@shared/types/notebook'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 入口文案：aria-label、悬停与菜单名称同源，读屏与视觉提示不会各写一份 */
const MORE_ACTIONS_LABEL = '更多操作'

/** 受限原因：入口不再原生禁用，提示要说明是笔记本操作暂不可用，而不是让图标灰得没有解释 */
const MORE_ACTIONS_DISABLED_TIP = '有操作进行中或正在搜索，笔记本操作暂不可用'

/** 排序菜单项：文案与落库取值同源，satisfies 让新增 NotebookSort 时漏配或多配在编译期即报错，键序即展示顺序 */
const SORT_LABELS = {
    mtime: '按修改时间',
    name: '按名称',
} satisfies Record<NotebookSort, string>

/** 菜单渲染序列：模块级算一次，避免每次渲染重建数组 */
const SORT_ENTRIES = Object.entries(SORT_LABELS)

interface NotesHeaderActionsProps {
    isSelecting: boolean
    onToggleSelecting: () => void
    sort: NotebookSort
    onChangeSort: (sort: NotebookSort) => void
    onCollapseAll: () => void
    onCreateNotebook: () => void
    /** 打开回收站页：入口与笔记本级动作同处一个下拉，不改动列表状态 */
    onOpenTrash: () => void
    /** 有操作在途或正在搜索时禁用笔记本级操作 */
    isDisabled: boolean
}

export function NotesHeaderActions({
    isSelecting,
    onToggleSelecting,
    sort,
    onChangeSort,
    onCollapseAll,
    onCreateNotebook,
    onOpenTrash,
    isDisabled,
}: NotesHeaderActionsProps): JSX.Element {
    /** 排序组的无障碍名称靠 id 关联到菜单标签，useId 保证同一页面多个实例也不撞车 */
    const sortLabelId = useId()
    if (isSelecting) {
        return (
            <Button
                variant="secondary"
                size="icon"
                aria-label="退出多选"
                tooltip="退出多选"
                onClick={onToggleSelecting}
            >
                <X />
            </Button>
        )
    }

    return (
        <div className="flex items-center">
            <Button variant="ghost" size="icon" aria-label="多选" tooltip="多选" onClick={onToggleSelecting}>
                <ListChecks />
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={MORE_ACTIONS_LABEL}
                        tooltip={isDisabled ? MORE_ACTIONS_DISABLED_TIP : MORE_ACTIONS_LABEL}
                        className="focus-visible:border-transparent focus-visible:ring-0 aria-expanded:bg-transparent"
                    >
                        <MoreHorizontal />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label={MORE_ACTIONS_LABEL} className="w-44">
                    <DropdownMenuItem disabled={isDisabled} onSelect={onCreateNotebook}>
                        <BookPlus />
                        新建笔记本
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={isDisabled} onSelect={onCollapseAll}>
                        <ListChevronsDownUp />
                        收起全部
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel id={sortLabelId}>排序方式</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        aria-labelledby={sortLabelId}
                        value={sort}
                        onValueChange={(value) => {
                            // 只接受枚举内的取值：非法值直接丢弃，不静默回落成 mtime 改写用户偏好
                            if (isNotebookSort(value)) {
                                onChangeSort(value)
                            }
                        }}
                    >
                        {SORT_ENTRIES.map(([value, label]) => (
                            <DropdownMenuRadioItem key={value} value={value} disabled={isDisabled}>
                                {label}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onOpenTrash}>
                        <Archive />
                        回收站
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
