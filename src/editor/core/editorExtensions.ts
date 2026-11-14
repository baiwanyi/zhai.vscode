/**
 * 编辑器扩展装配：基础语法 + 占位、任务列表、表格、图片、批注、光标行、查找与斜杠命令。
 * 复用约定：只产出配置，不持有状态；调用方用 useMemo 构造一次后交给 useEditor。
 * 关键约束：扩展实例不可跨 editor 复用（Tiptap 的 resolveExtensions 不复制实例），
 * 因此保持工厂而非模块级常量；占位文案里必须保留 `/`，斜杠菜单是块命令的唯一发现入口；
 * 块运行期 id 仅用于编辑态定位（批注锚点 / 拖拽），转 Markdown 时会被丢弃，不写入正文。
 */
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import UniqueID from '@tiptap/extension-unique-id'
import StarterKit from '@tiptap/starter-kit'
import { CursorLineExtension } from './cursorLineExtension'
import type { Extensions } from '@tiptap/core'
import { AnnotationExtension } from '../annotations/annotationExtension'
import { ZhaiImage } from '../image/ZhaiImage'
import { SearchExtension } from '../search/searchExtension'
import { SlashCommandExtension } from '../slash/slashCommandExtension'

/** 空行占位提示：斜杠菜单是发现块命令的唯一入口，文案里必须把 `/` 说出来 */
const PLACEHOLDER_TEXT = '开始写作，输入 / 唤起命令…'

export function createEditorExtensions(): Extensions {
    return [
        // 链接：预置在 StarterKit 里，关掉点击跳转与自动识别，避免点正文里的链接就跳出编辑器、
        // 也避免敲一个裸 URL 就把纯文本改写成链接语法
        StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
        // 空行占位提示：装饰只落在光标所在的空文本块上，形态见 editor.css 的 .is-empty
        Placeholder.configure({ placeholder: PLACEHOLDER_TEXT }),
        // 任务列表：md 侧由 adaptTaskListHtml 转成 data-type 结构，回写由 toTaskMarkdown 还原 GFM
        TaskList,
        TaskItem.configure({ nested: true }),
        // 表格：md 侧由 adaptTableHtml 给单元格补 <p>，回写由 toTableMarkdown 拼 GFM
        TableKit.configure({ table: { resizable: false } }),
        // 图片：显示时把 @zhai/ 转成 webview 地址，序列化仍保留原始引用
        ZhaiImage.configure({ inline: false, allowBase64: false }),
        AnnotationExtension,
        // 当前行：给光标所在块挂 class，editor.css 据此高亮左侧行号
        CursorLineExtension,
        SearchExtension,
        SlashCommandExtension,
        UniqueID.configure({
            types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock'],
            attributeName: 'id',
        }),
    ]
}
