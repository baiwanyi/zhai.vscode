/**
 * 表格块的菜单项：结构操作子菜单，只服务块把手的「表格操作」项。
 * 复用约定：菜单壳取 @components/ui/dropdown-menu，命令清单与执行入口来自 ./tableBlockActions，
 * 本文件只负责渲染，不持有状态、不判断可写性。
 * 关键约束：子菜单的挂载与开合由外层的 DropdownMenuSub 负责；
 * 目标块位置为 null（已失效）时全部条目置灰，避免给出无效操作。
 */
import { Table } from 'lucide-react'
import {
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'
import { runTableStructureAction, TABLE_ACTIONS } from './tableBlockActions'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'

export interface TableBlockMenuItemsProps {
    editor: Editor
    /** 目标块起始位置：菜单打开瞬间冻结，为 null 时全部条目置灰 */
    pos: number | null
}

export function TableBlockMenuItems({ editor, pos }: TableBlockMenuItemsProps): JSX.Element {
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <Table />
                <span className="flex-1">表格操作</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
                {TABLE_ACTIONS.map((action) => {
                    const Icon = action.icon
                    return (
                        <DropdownMenuItem
                            key={action.label}
                            disabled={pos === null}
                            onSelect={(): void => {
                                if (pos === null) {
                                    return
                                }
                                runTableStructureAction(editor, pos, action.run)
                            }}
                        >
                            <Icon />
                            {action.label}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    )
}
