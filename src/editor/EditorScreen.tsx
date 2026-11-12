/**
 * 编辑器 webview 主屏：承载 TipTap 编辑区，后续接入标注装饰、浮动菜单与 AI 查询。
 * 复用约定：挂载与主题由 src/bootstrap 统一处理，本组件只管编辑区布局与状态栏；
 * 正文样式走 Tailwind 语义类，字号继承 globals.css 的 --text-base（随 VSCode 界面字号变化）。
 * 关键约束：本阶段正文只存在于 webview 内存，P0-2 起改以宿主 TextDocument 为唯一真相；
 * 不在组件内引入第二套主题或字号变量，避免与 VSCode 主题桥接冲突。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSX } from 'react'

/** 初始占位正文：只用于验证挂载与主题，接入宿主文档后由 editor/doc 覆盖 */
const PLACEHOLDER_CONTENT = '<p>在这里开始写作。选中文本后会出现操作菜单。</p>'

export function EditorScreen(): JSX.Element {
    const editor = useEditor({
        extensions: [StarterKit],
        content: PLACEHOLDER_CONTENT,
        editorProps: {
            attributes: {
                class: 'min-h-[60vh] text-base leading-8 outline-none',
            },
        },
    })

    return (
        <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
            <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto w-full max-w-3xl px-8 py-10">
                    <EditorContent editor={editor} />
                </div>
            </div>
            <div className="flex shrink-0 items-center border-t px-4 py-1.5 text-xs text-muted-foreground">
                富文本模式 · 正文接入中
            </div>
        </div>
    )
}
