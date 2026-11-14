/**
 * 只读守卫：选区工具条各写入入口的统一前置判断，只读时提示一次并让调用方早返回。
 * 复用约定：命令层（formatCommands / blockCommands）遇到只读是静默 return，提示只能落在 UI 层，
 * 划线、链接、块类型、清除格式与行内格式共用这一句，避免文案与判定分叉。
 * 关键约束：调用方必须用返回值做早返回，否则提示与「真的执行」会脱节；
 * 编辑器已销毁时静默返回 false，不占屏幕提示。
 */
import { toast } from 'sonner'
import type { Editor } from '@tiptap/react'

/** 只读提示：与文档同步失败提示同口径，说明「改动不会写回」而不是「按钮坏了」 */
const READONLY_MESSAGE = '当前文档为只读，改动不会写回'

/** 编辑器现在能否写入：不可写时由本函数负责提示，调用方只做早返回 */
export function ensureEditable(editor: Editor): boolean {
    if (editor.isDestroyed) {
        return false
    }
    if (editor.isEditable) {
        return true
    }
    toast.error(READONLY_MESSAGE)
    return false
}
