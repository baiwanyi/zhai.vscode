/**
 * 编辑器 webview 主屏：承载 TipTap 编辑区，正文与宿主 TextDocument 双向同步。
 * 复用约定：内容读写与状态收敛在 useEditorDocument，挂载与主题由 src/bootstrap 统一处理；
 * 正文样式走 Tailwind 语义类，字号继承 globals.css 的 --text-base（随 VSCode 界面字号变化）。
 * 关键约束：本组件不直接发协议请求，也不自行决定可编辑性——只读判定来自宿主快照；
 * 状态栏必须如实展示同步状态，出现只读或同步失败时不能让用户以为内容已保存。
 */
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEditorDocument } from './hooks/useEditorDocument'
import { SelectionToolbar } from './layout/SelectionToolbar'
import type { JSX } from 'react'

export function EditorScreen(): JSX.Element {
    const editor = useEditor({
        extensions: [StarterKit],
        content: '<p></p>',
        editorProps: {
            attributes: {
                class: 'min-h-[60vh] text-base leading-8 outline-none',
            },
        },
    })
    const { status, isEditable } = useEditorDocument(editor)

    return (
        <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
            <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto w-full max-w-3xl px-8 py-10">
                    <EditorContent editor={editor} />
                    <SelectionToolbar editor={editor} />
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5 text-xs text-muted-foreground">
                <span>{status}</span>
                {isEditable ? null : <span>切换回文本编辑器可继续编辑</span>}
            </div>
        </div>
    )
}
