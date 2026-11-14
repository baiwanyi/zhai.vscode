/**
 * 表格块的结构命令：菜单项清单与统一执行入口，供块把手的「表格操作」子菜单与删除项共用。
 * 复用约定：落位与命令走 tableActions 的 focusTableAtBlock，只读守卫走 toolbar/editableGuard，
 * 与其它编辑器写入口共用同一条提示；本模块不含 JSX，图标只作为数据引用。
 * 关键约束：命令只作用于光标所在行列，执行前必须先把光标落进目标表格，否则会改到另一张表；
 * run() 返回 false 表示被 schema 拒绝（删到只剩一行 / 一列），必须提示，否则用户以为点击没生效。
 */
import {
    ArrowDownToLine,
    ArrowLeftToLine,
    ArrowRightToLine,
    ArrowUpToLine,
    Columns3,
    Rows3,
    TableProperties,
} from 'lucide-react'
import { toast } from 'sonner'
import { focusTableAtBlock } from './tableActions'
import type { Editor } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'
import { ensureEditable } from '../toolbar/editableGuard'

/** 表格结构命令被 schema 拒绝时的提示：删到只剩一行 / 一列、表头切换不可用等都会走到这里 */
const MESSAGE_TABLE_ACTION_FAILED = '这个表格操作在当前结构下不可用'

/** 表格结构操作：每一项都直接作用于表格内的当前光标行列，执行前由 runTableStructureAction 落位 */
export const TABLE_ACTIONS: ReadonlyArray<{ label: string; icon: LucideIcon; run: (editor: Editor) => boolean }> = [
    { label: '上方插入行', icon: ArrowUpToLine, run: (editor) => editor.chain().focus().addRowBefore().run() },
    { label: '下方插入行', icon: ArrowDownToLine, run: (editor) => editor.chain().focus().addRowAfter().run() },
    { label: '左侧插入列', icon: ArrowLeftToLine, run: (editor) => editor.chain().focus().addColumnBefore().run() },
    { label: '右侧插入列', icon: ArrowRightToLine, run: (editor) => editor.chain().focus().addColumnAfter().run() },
    { label: '删除当前行', icon: Rows3, run: (editor) => editor.chain().focus().deleteRow().run() },
    { label: '删除当前列', icon: Columns3, run: (editor) => editor.chain().focus().deleteColumn().run() },
    { label: '切换表头行', icon: TableProperties, run: (editor) => editor.chain().focus().toggleHeaderRow().run() },
]

/**
 * 执行一条表格结构命令：先判只读、再把光标落进目标表格，最后按 run() 的结果决定是否提示失败。
 * 块菜单的「删除」（删表）与子菜单里的七项操作共用这一条路径。
 */
export function runTableStructureAction(editor: Editor, pos: number, run: (target: Editor) => boolean): void {
    if (!ensureEditable(editor)) {
        return
    }
    if (!focusTableAtBlock(editor, pos)) {
        return
    }
    if (!run(editor)) {
        toast.error(MESSAGE_TABLE_ACTION_FAILED)
    }
}
