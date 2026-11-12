/**
 * 块内容判定：判断顶层块是否属于「没有内容的空行」，供块把手决定给插入按钮还是拖拽手柄。
 * 复用约定：只读 ProseMirror 节点，不碰编辑器与 DOM；实体节点清单集中在这里，新增可拖拽节点只改一处。
 * 关键约束：不能只看 content.size——只含空格或硬换行的行尺寸非零、视觉上却是空行，
 * 只看尺寸会让这类空行冒出拖拽手柄，而真正有内容的空表格又被当成空行。
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 视觉上一定有东西的节点：块本身或块里出现它们就不再算空行（空表格、分隔线、图片都要能被拖） */
const SOLID_NODE_TYPES: ReadonlySet<string> = new Set(['image', 'table', 'horizontalRule', 'codeBlock'])

/** 空行：无可见文本、无实体内容；文本按 trim 判断，空白与硬换行都算空 */
export function isBlankBlock(node: ProseMirrorNode): boolean {
    if (node.isLeaf || SOLID_NODE_TYPES.has(node.type.name) || node.textContent.trim().length > 0) {
        return false
    }
    let hasSolid = false
    node.descendants((child) => {
        if (hasSolid) {
            return false
        }
        if (SOLID_NODE_TYPES.has(child.type.name)) {
            hasSolid = true
            return false
        }
        return true
    })
    return !hasSolid
}
