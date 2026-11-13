/**
 * 块级命令：把手菜单里的类型转换、复制与删除，只读写 ProseMirror 文档。
 * 复用约定：入参统一是「顶层块起始位置」，命令返回是否真的执行；DOM、剪贴板与提示都不在这里，
 * 结构重建直接走 schema 而不是链式 toggleXxx——跨类型（列表 ↔ 文本块）时链式命令只改局部语义。
 * 关键约束：复制必须递归清空 id——UniqueID 只补缺失值、不去重，同 id 的两块会让批注与定位串位；
 * 删除必须保证文档至少留一个空段落，否则事务会被 schema 拒绝、块根本删不掉；
 * 表格 / 图片 / 分隔线没有可读的段落内容，一律返回 false，由菜单置灰而不是猜一个形态。
 */
import { Selection } from '@tiptap/pm/state'
import { Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Pilcrow, Quote, SquareCode } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import type { LucideIcon } from 'lucide-react'

/** 转换目标标识：与下方清单一一对应，命令层只认这个联合类型 */
export type BlockTargetId =
    | 'paragraph'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'bulletList'
    | 'orderedList'
    | 'taskList'
    | 'blockquote'
    | 'codeBlock'

/** 一条转换目标：图标存组件引用，菜单层负责渲染，本文件保持纯 TS */
export interface BlockTarget {
    id: BlockTargetId
    label: string
    icon: LucideIcon
}

/** 转换目标清单：顺序即子菜单展示顺序，与「/」菜单的块类型保持一致 */
export const BLOCK_TARGETS: readonly BlockTarget[] = [
    { id: 'paragraph', label: '正文', icon: Pilcrow },
    { id: 'heading1', label: '一级标题', icon: Heading1 },
    { id: 'heading2', label: '二级标题', icon: Heading2 },
    { id: 'heading3', label: '三级标题', icon: Heading3 },
    { id: 'bulletList', label: '无序列表', icon: List },
    { id: 'orderedList', label: '有序列表', icon: ListOrdered },
    { id: 'taskList', label: '任务列表', icon: ListTodo },
    { id: 'blockquote', label: '引用', icon: Quote },
    { id: 'codeBlock', label: '代码块', icon: SquareCode },
]

/** 标题层级文案：超出三级标题后回落到「标题 N」，不再堆长句 */
const HEADING_LABELS: readonly string[] = ['一级标题', '二级标题', '三级标题']

/** 可参与转换的源块：其余块（表格、图片、分隔线）没有可拆的段落内容 */
const CONVERTIBLE_SOURCES: ReadonlySet<string> = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'taskList',
    'codeBlock',
])

/** 纯文本块类型：标签按类型名直接映射 */
const SIMPLE_LABELS: Readonly<Record<string, string>> = {
    paragraph: '正文',
    bulletList: '无序列表',
    orderedList: '有序列表',
    taskList: '任务列表',
    blockquote: '引用',
    codeBlock: '代码块',
    table: '表格',
    image: '图片',
    horizontalRule: '分隔线',
}

/** 目标与标题层级的映射：只在 heading 系列上命中 */
const TARGET_HEADING_LEVELS: Readonly<Partial<Record<BlockTargetId, number>>> = {
    heading1: 1,
    heading2: 2,
    heading3: 3,
}

/** 读取顶层块：pos 越界时返回 null，nodeAt 在越界位置会抛 RangeError */
export function readBlockNode(editor: Editor, pos: number): ProseMirrorNode | null {
    if (editor.isDestroyed || pos < 0 || pos >= editor.state.doc.content.size) {
        return null
    }
    return editor.state.doc.nodeAt(pos)
}

/** 块纯文本：复制文本与 AI 询问都取这一份口径 */
export function readBlockText(node: ProseMirrorNode): string {
    return node.textContent
}

/** 块类型标签：菜单首行的只读标题 */
export function readBlockLabel(node: ProseMirrorNode): string {
    if (node.type.name === 'heading') {
        const level = Number(node.attrs.level ?? 1)
        return HEADING_LABELS[level - 1] ?? `标题 ${level}`
    }
    return SIMPLE_LABELS[node.type.name] ?? node.type.name
}

/** 源块能否转换：表格、图片、分隔线一律不给入口 */
export function canConvertBlock(node: ProseMirrorNode): boolean {
    return CONVERTIBLE_SOURCES.has(node.type.name)
}

/** 当前块是否已经是该目标：菜单据此置灰，命令层也靠它避免写一次无意义的替换 */
export function isCurrentTarget(node: ProseMirrorNode, target: BlockTargetId): boolean {
    const level = TARGET_HEADING_LEVELS[target]
    if (level !== undefined) {
        return node.type.name === 'heading' && Number(node.attrs.level) === level
    }
    return node.type.name === target
}

/**
 * 把块内容收成段落分组：外层一个元素对应「一个列表项 / 一个段落」，
 * 内层保留同组的多段落——列表项里的多段转到列表仍然留在同一项，不会被拆成两项。
 * 代码块按行拆组，空行留空段落；不支持的块返回 null。
 */
function collectParagraphGroups(node: ProseMirrorNode, schema: Schema): ProseMirrorNode[][] | null {
    const paragraphType = schema.nodes.paragraph
    if (paragraphType === undefined) {
        return null
    }
    switch (node.type.name) {
        case 'paragraph':
        case 'heading':
            return [[paragraphType.create(null, node.content)]]
        case 'codeBlock': {
            return node.textContent
                .split('\n')
                .map((line) => [paragraphType.create(null, line.length === 0 ? null : schema.text(line))])
        }
        case 'blockquote': {
            const groups: ProseMirrorNode[][] = []
            node.forEach((child) => {
                const inner = collectParagraphGroups(child, schema)
                if (inner !== null) {
                    groups.push(...inner)
                }
            })
            return groups.length > 0 ? groups : null
        }
        case 'bulletList':
        case 'orderedList':
        case 'taskList': {
            const groups: ProseMirrorNode[][] = []
            node.forEach((item) => {
                const inner = collectParagraphGroups(item, schema)
                if (inner !== null) {
                    groups.push(...inner)
                }
            })
            return groups.length > 0 ? groups : null
        }
        case 'listItem':
        case 'taskItem': {
            // 列表项内的段落与嵌套块按顺序收进同一组，嵌套列表会被拍平（与 Notion 的转换口径一致）
            const group: ProseMirrorNode[] = []
            node.forEach((child) => {
                const inner = collectParagraphGroups(child, schema)
                if (inner === null) {
                    return
                }
                for (const item of inner) {
                    group.push(...item)
                }
            })
            return group.length > 0 ? [group] : null
        }
        default:
            return null
    }
}

/** 按目标类型重建顶层节点：返回数组是因为标题块可能带出多段正文，列表 ↔ 文本块也会改变块数量 */
function buildTargetNodes(
    schema: Schema,
    target: BlockTargetId,
    groups: readonly ProseMirrorNode[][],
): ProseMirrorNode[] | null {
    const flat = groups.flat()
    if (flat.length === 0) {
        return null
    }
    switch (target) {
        case 'paragraph':
            return flat
        case 'heading1':
        case 'heading2':
        case 'heading3': {
            const headingType = schema.nodes.heading
            const first = flat[0]
            if (headingType === undefined || first === undefined) {
                return null
            }
            const level = TARGET_HEADING_LEVELS[target]
            if (level === undefined) {
                return null
            }
            return [headingType.create({ level }, first.content), ...flat.slice(1)]
        }
        case 'bulletList':
        case 'orderedList': {
            const listType = schema.nodes[target]
            const itemType = schema.nodes.listItem
            if (listType === undefined || itemType === undefined) {
                return null
            }
            return [
                listType.create(
                    null,
                    groups.map((group) => itemType.create(null, group)),
                ),
            ]
        }
        case 'taskList': {
            const listType = schema.nodes.taskList
            const itemType = schema.nodes.taskItem
            if (listType === undefined || itemType === undefined) {
                return null
            }
            return [
                listType.create(
                    null,
                    groups.map((group) => itemType.create({ checked: false }, group)),
                ),
            ]
        }
        case 'blockquote': {
            const quoteType = schema.nodes.blockquote
            if (quoteType === undefined) {
                return null
            }
            return [quoteType.create(null, flat)]
        }
        case 'codeBlock': {
            const codeType = schema.nodes.codeBlock
            if (codeType === undefined) {
                return null
            }
            const text = flat.map((item) => item.textContent).join('\n')
            return [codeType.create(null, text.length === 0 ? null : schema.text(text))]
        }
        default:
            return null
    }
}

/** 转换块类型：保留内联 marks（加粗、斜体、链接），块级结构按目标重建 */
export function convertBlock(editor: Editor, pos: number, target: BlockTargetId): boolean {
    if (editor.isDestroyed || !editor.isEditable) {
        return false
    }
    const node = readBlockNode(editor, pos)
    if (node === null || isCurrentTarget(node, target)) {
        return false
    }
    const groups = collectParagraphGroups(node, editor.schema)
    if (groups === null) {
        return false
    }
    const nodes = buildTargetNodes(editor.schema, target, groups)
    if (nodes === null || nodes.length === 0) {
        return false
    }
    const { tr } = editor.state
    tr.replaceWith(pos, pos + node.nodeSize, nodes)
    // 光标落进新块的第一个位置：直接在替换后的块起点定位会落在节点边界上
    tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
    editor.view.dispatch(tr)
    return true
}

/**
 * 清空节点树上的 id：只处理 schema 里声明了 id 属性的类型，其余节点原样返回。
 * 不能只清顶层——列表项与标题同样带 id，漏掉一处仍会与源块撞车。
 */
function stripBlockIds(node: ProseMirrorNode): ProseMirrorNode {
    if (node.isText || node.isLeaf) {
        return node
    }
    const children: ProseMirrorNode[] = []
    node.forEach((child) => {
        children.push(stripBlockIds(child))
    })
    const specAttrs = node.type.spec.attrs
    const attrs =
        specAttrs !== null && specAttrs !== undefined && 'id' in specAttrs ? { ...node.attrs, id: null } : node.attrs
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
