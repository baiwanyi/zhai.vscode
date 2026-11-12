/**
 * 斜杠命令清单与执行：`/` 菜单里每一项对应一次编辑器事务。
 * 复用约定：图标存 lucide 组件引用而不是 JSX 元素，本文件因此保持纯 TS（不含 React 渲染）；
 * 执行统一走 editor.chain()，只描述「有什么命令、怎么执行」，不认识弹层与键盘。
 * 关键约束：执行前必须 deleteRange 去掉用户已输入的「/xxx」，否则命令插入的节点会带着这段文字；
 * 首批只做 StarterKit 内建块（标题 / 列表 / 引用 / 代码块 / 分隔线），图片与表格留到后续批次，
 * 它们需要上传通道与白名单放开，现在放进来只会造出无法保存的内容。
 */
import {
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    ListTodo,
    Minus,
    Pilcrow,
    Quote,
    SquareCode,
    Table as TableIcon,
    Type,
} from 'lucide-react'
import type { ChainedCommands, Editor, Range } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'

/** 一条斜杠命令：run 必须是同步的编辑器事务，不接受异步副作用 */
export interface SlashCommand {
    id: string
    label: string
    hint: string
    /** 参与搜索的额外关键词：让 `/h2` 这类输入也能命中 */
    keywords: readonly string[]
    icon: LucideIcon
    /** range 为 null 表示不是从斜杠菜单触发（例如把手上的「转换为」），此时不删除任何文本 */
    run: (editor: Editor, range: Range | null) => void
}

/** 统一执行：先删掉触发的「/查询词」，再跑命令，并保证焦点回到正文 */
function apply(editor: Editor, range: Range | null, action: (chain: ChainedCommands) => ChainedCommands): void {
    const chain = editor.chain().focus()
    action(range === null ? chain : chain.deleteRange(range)).run()
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
    {
        id: 'paragraph',
        label: '正文',
        hint: '普通段落',
        keywords: ['text', 'p', 'paragraph', '正文'],
        icon: Pilcrow,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.setParagraph())
        },
    },
    {
        id: 'heading1',
        label: '一级标题',
        hint: '章标题',
        keywords: ['h1', 'title', 'heading', '标题'],
        icon: Heading1,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleHeading({ level: 1 }))
        },
    },
    {
        id: 'heading2',
        label: '二级标题',
        hint: '节标题',
        keywords: ['h2', 'heading', '标题'],
        icon: Heading2,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleHeading({ level: 2 }))
        },
    },
    {
        id: 'heading3',
        label: '三级标题',
        hint: '小节标题',
        keywords: ['h3', 'heading', '标题'],
        icon: Heading3,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleHeading({ level: 3 }))
        },
    },
    {
        id: 'bulletList',
        label: '无序列表',
        hint: '要点罗列',
        keywords: ['ul', 'bullet', 'list', '列表'],
        icon: List,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleBulletList())
        },
    },
    {
        id: 'taskList',
        label: '任务列表',
        hint: '待办勾选',
        keywords: ['todo', 'task', 'check', '任务', '待办'],
        icon: ListTodo,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleTaskList())
        },
    },
    {
        id: 'orderedList',
        label: '有序列表',
        hint: '带编号的步骤',
        keywords: ['ol', 'number', 'list', '列表'],
        icon: ListOrdered,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleOrderedList())
        },
    },
    {
        id: 'table',
        label: '表格',
        hint: '3 × 3 带表头',
        keywords: ['table', 'grid', '表格'],
        icon: TableIcon,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))
        },
    },
    {
        id: 'blockquote',
        label: '引用',
        hint: '摘录与旁白',
        keywords: ['quote', 'blockquote', '引用'],
        icon: Quote,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleBlockquote())
        },
    },
    {
        id: 'codeBlock',
        label: '代码块',
        hint: '等宽原文',
        keywords: ['code', 'pre', '代码'],
        icon: SquareCode,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.toggleCodeBlock())
        },
    },
    {
        id: 'horizontalRule',
        label: '分隔线',
        hint: '场景分隔',
        keywords: ['hr', 'divider', '分隔'],
        icon: Minus,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.setHorizontalRule())
        },
    },
    {
        id: 'plain',
        label: '纯文本',
        hint: '清除格式',
        keywords: ['clear', 'unset', '清除'],
        icon: Type,
        run: (editor, range): void => {
            apply(editor, range, (chain) => chain.unsetAllMarks().clearNodes())
        },
    },
]

/**
 * 块类型转换（turn into）可用项：只保留能直接套在文本块上的命令。
 * 分隔线与纯文本不是「转换」语义（前者插入新块、后者是清格式），故排除。
 */
const TURN_INTO_IDS: readonly string[] = [
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'bulletList',
    'orderedList',
    'taskList',
    'blockquote',
    'codeBlock',
]

export const TURN_INTO_COMMANDS: readonly SlashCommand[] = SLASH_COMMANDS.filter((command) =>
    TURN_INTO_IDS.includes(command.id),
)

/** 按查询词过滤：匹配 label、id 与关键词，空查询返回全部 */
export function filterSlashCommands(query: string): SlashCommand[] {
    const keyword = query.trim().toLowerCase()
    if (keyword.length === 0) {
        return [...SLASH_COMMANDS]
    }
    return SLASH_COMMANDS.filter(
        (command) =>
            command.label.toLowerCase().includes(keyword) ||
            command.id.toLowerCase().includes(keyword) ||
            command.keywords.some((item) => item.toLowerCase().includes(keyword)),
    )
}
