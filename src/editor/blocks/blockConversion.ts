/**
 * 块类型转换：把可转换块拆成段落分组，按目标类型重建顶层节点，最后整块替换并落光标。
 * 复用约定：结构一律直接走 schema 重建（不用链式 toggleXxx），目标语义与标题层级取自 blockTargets，
 * 块读取走 blockQueries；本模块只做转换，不碰 DOM、剪贴板与提示。
 * 关键约束：转换是全有或全无——容器里只要有一个子块不可转换（图片、表格、分隔线）就整体放弃，
 * 部分转换会静默丢内容；canConvertBlock 必须与 convertBlock 的真实结果一致，菜单才能据此置灰。
 */
import { Selection } from '@tiptap/pm/state'
import { readBlockNode } from './blockQueries'
import { isCurrentTarget, readTargetHeadingLevel } from './blockTargets'
import type { BlockTargetId } from './blockTargets'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'

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

/** 源块能否转换：顶层类型与块内每个子块都必须可无损转换，表格、图片、分隔线一律不给入口 */
export function canConvertBlock(node: ProseMirrorNode): boolean {
    return CONVERTIBLE_SOURCES.has(node.type.name) && collectParagraphGroups(node, node.type.schema) !== null
}

/**
 * 收集容器直接子块的分组：引用与三种列表的子块处理完全一致，任一子块不可转换就整体放弃。
 * 返回 null 表示这段内容无法无损转换，上游据此放弃整块（不做部分转换）。
 */
function collectChildGroups(parent: ProseMirrorNode, schema: Schema): ProseMirrorNode[][] | null {
    const groups: ProseMirrorNode[][] = []
    let isConvertible = true
    parent.forEach((child) => {
        const inner = collectParagraphGroups(child, schema)
        if (inner === null) {
            isConvertible = false
            return
        }
        groups.push(...inner)
    })
    return isConvertible && groups.length > 0 ? groups : null
}

/**
 * 把块内容收成段落分组：外层一个元素对应「一个列表项 / 一个段落」，
 * 内层保留同组的多段落——列表项里的多段转到列表仍然留在同一项，不会被拆成两项。
 * 代码块按行拆组，空行留空段落；不支持的块返回 null。
 * 容器里只要有一个子块不可转换（图片、表格、分隔线）就整体返回 null——部分转换会静默丢内容。
 * 导出仅为单测覆盖，业务侧请走 canConvertBlock / convertBlock。
 */
export function collectParagraphGroups(node: ProseMirrorNode, schema: Schema): ProseMirrorNode[][] | null {
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
        case 'blockquote':
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
            return collectChildGroups(node, schema)
        case 'listItem':
        case 'taskItem': {
            // 列表项内的段落与嵌套块按顺序收进同一组，嵌套列表会被拍平（与 Notion 的转换口径一致）
            const group: ProseMirrorNode[] = []
            let isConvertible = true
            node.forEach((child) => {
                const inner = collectParagraphGroups(child, schema)
                if (inner === null) {
                    isConvertible = false
                    return
                }
                for (const item of inner) {
                    group.push(...item)
                }
            })
            return isConvertible && group.length > 0 ? [group] : null
        }
        default:
            return null
    }
}

/** 重建目标节点时的入参：schema 与 target 决定节点类型，groups 保留「一个列表项一组」的结构 */
interface BuildContext {
    schema: Schema
    target: BlockTargetId
    groups: readonly ProseMirrorNode[][]
    flat: ProseMirrorNode[]
}

/** 单个目标的构造规则：返回顶层节点数组，schema 缺节点类型时返回 null */
type TargetBuilder = (context: BuildContext) => ProseMirrorNode[] | null

/** 正文：分组早已是段落，直接铺开 */
function buildParagraph({ flat }: BuildContext): ProseMirrorNode[] | null {
    return flat
}

/** 标题：第一段升为标题，其余多段继续以段落留在后面，避免吞掉内容 */
function buildHeading({ schema, target, flat }: BuildContext): ProseMirrorNode[] | null {
    const headingType = schema.nodes.heading
    const first = flat[0]
    const level = readTargetHeadingLevel(target)
    if (headingType === undefined || first === undefined || level === undefined) {
        return null
    }
    return [headingType.create({ level }, first.content), ...flat.slice(1)]
}

/** 无序 / 有序列表：一个分组一个列表项，分组内的多段落留在同一项 */
function buildList({ schema, target, groups }: BuildContext): ProseMirrorNode[] | null {
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

/** 任务列表：与普通列表同构，列表项多一个未勾选的 checked 状态 */
function buildTaskList({ schema, groups }: BuildContext): ProseMirrorNode[] | null {
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

/** 引用：所有段落压进同一个引用块 */
function buildQuote({ schema, flat }: BuildContext): ProseMirrorNode[] | null {
    const quoteType = schema.nodes.blockquote
    if (quoteType === undefined) {
        return null
    }
    return [quoteType.create(null, flat)]
}

/** 代码块：段落按行拼回纯文本，块内 marks 不保留（代码块只存文本） */
function buildCodeBlock({ schema, flat }: BuildContext): ProseMirrorNode[] | null {
    const codeType = schema.nodes.codeBlock
    if (codeType === undefined) {
        return null
    }
    const text = flat.map((item) => item.textContent).join('\n')
    return [codeType.create(null, text.length === 0 ? null : schema.text(text))]
}

/** 目标与构造规则的映射：新增目标只需补一条，不必再改分支 */
const TARGET_BUILDERS: Readonly<Record<BlockTargetId, TargetBuilder>> = {
    paragraph: buildParagraph,
    heading1: buildHeading,
    heading2: buildHeading,
    heading3: buildHeading,
    bulletList: buildList,
    orderedList: buildList,
    taskList: buildTaskList,
    blockquote: buildQuote,
    codeBlock: buildCodeBlock,
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
    return TARGET_BUILDERS[target]({ schema, target, groups, flat })
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
