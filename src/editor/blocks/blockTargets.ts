/**
 * 块转换目标清单：目标标识、菜单文案与图标、标题层级映射，只描述「有哪些目标、怎么显示」。
 * 复用约定：不碰 ProseMirror 文档也不引编辑器实例，消费方是块把手菜单与转换层的可转换性判定；
 * 标题层级映射与目标标识同源，转换层经 readTargetHeadingLevel 取值，不要再另抄一份表。
 * 关键约束：BLOCK_TARGETS 的顺序即子菜单展示顺序，与「/」菜单的块类型保持可读一致；
 * 本文件是唯一持有 lucide 图标引用的地方，命令与查询模块不得从这里反向导出图标。
 */
import { Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Pilcrow, Quote, SquareCode } from 'lucide-react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
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

/** 一条转换目标：图标存组件引用，菜单层负责渲染 */
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

/** 目标对应的标题层级：非标题目标返回 undefined，转换层据此决定 heading 的 attrs.level */
export function readTargetHeadingLevel(target: BlockTargetId): number | undefined {
    return TARGET_HEADING_LEVELS[target]
}

/** 块类型标签：菜单首行的只读标题 */
export function readBlockLabel(node: ProseMirrorNode): string {
    if (node.type.name === 'heading') {
        const level = Number(node.attrs.level ?? 1)
        return HEADING_LABELS[level - 1] ?? `标题 ${level}`
    }
    return SIMPLE_LABELS[node.type.name] ?? node.type.name
}

/** 当前块是否已经是该目标：菜单据此置灰，命令层也靠它避免写一次无意义的替换 */
export function isCurrentTarget(node: ProseMirrorNode, target: BlockTargetId): boolean {
    const level = readTargetHeadingLevel(target)
    if (level !== undefined) {
        return node.type.name === 'heading' && Number(node.attrs.level) === level
    }
    return node.type.name === target
}

/** 一个转换目标在菜单里的状态：当前块已经是它时置灰或打勾 */
export interface ConvertTargetState {
    target: BlockTarget
    isCurrent: boolean
}

/**
 * 转换目标的展示状态：块把手菜单与选区块类型菜单共用同一套「当前项」判定。
 * 渲染方式（置灰还是打勾）由各自决定，这里只统一计算，避免两处判定各写一份。
 */
export function readConvertTargetStates(node: ProseMirrorNode | null): readonly ConvertTargetState[] {
    return BLOCK_TARGETS.map((target) => ({
        target,
        isCurrent: node !== null && isCurrentTarget(node, target.id),
    }))
}
