/**
 * 块结构写命令：复制与删除顶层块，各自在单个事务里改文档。
 * 复用约定：入参统一是「顶层块起始位置」（取自 blockQueries 的 readTopBlockPos），返回是否真的执行；
 * 块读取走 blockQueries，DOM、剪贴板与提示都不在这里，由调用方负责。
 * 关键约束：复制必须递归清空 id（含叶子块）——UniqueID 只补缺失值、不去重，同 id 的两块会让批注与定位串位；
 * 删除必须保证文档至少留一个空段落，否则事务会被 schema 拒绝、块根本删不掉。
 */
import { Selection } from '@tiptap/pm/state'
import { readBlockNode } from './blockQueries'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * 清空节点树上的 id：只处理 schema 里声明了 id 属性的类型，其余节点原样返回。
 * 不能只清顶层——列表项与标题同样带 id，漏掉一处仍会与源块撞车。
 * 叶子块（图片等）也要看 spec：id 一旦配到叶子上，按 isLeaf 直接返回就会漏清。
 */
function stripBlockIds(node: ProseMirrorNode): ProseMirrorNode {
    if (node.isText) {
        return node
    }
    const specAttrs = node.type.spec.attrs
    const attrs =
        specAttrs !== null && specAttrs !== undefined && 'id' in specAttrs ? { ...node.attrs, id: null } : node.attrs
    if (node.isLeaf) {
        return attrs === node.attrs ? node : node.type.create(attrs, null, node.marks)
    }
    const children: ProseMirrorNode[] = []
    node.forEach((child) => {
        children.push(stripBlockIds(child))
    })
    return node.type.create(attrs, children, node.marks)
}

/** 复制块：副本紧跟原块，id 交给 UniqueID 重新生成，避免两块共用同一个定位键 */
export function duplicateBlock(editor: Editor, pos: number): boolean {
    if (editor.isDestroyed || !editor.isEditable) {
        return false
    }
    const node = readBlockNode(editor, pos)
    if (node === null) {
        return false
    }
    const { tr } = editor.state
    tr.insert(pos + node.nodeSize, stripBlockIds(node))
    editor.view.dispatch(tr)
    return true
}

/**
 * 删除块：唯一块必须「替换成空段落」而不是「先删后补」——
 * doc 的 content 是 block+，删空的中间态会被 schema 直接拒绝，整个事务根本派发不出去。
 */
export function deleteBlock(editor: Editor, pos: number): boolean {
    if (editor.isDestroyed || !editor.isEditable) {
        return false
    }
    const node = readBlockNode(editor, pos)
    if (node === null) {
        return false
    }
    const { tr } = editor.state
    if (tr.doc.childCount === 1) {
        const paragraphType = editor.schema.nodes.paragraph
        if (paragraphType === undefined) {
            return false
        }
        tr.replaceWith(pos, pos + node.nodeSize, paragraphType.create())
        tr.setSelection(Selection.near(tr.doc.resolve(0)))
        editor.view.dispatch(tr)
        return true
    }
    tr.delete(pos, pos + node.nodeSize)
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
    editor.view.dispatch(tr)
    return true
}
