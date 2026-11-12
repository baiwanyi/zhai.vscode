/**
 * 富文本插入：接收宿主发来的 insert 消息，图片插节点、其余插文本。
 * 复用约定：与定位、查询共用 state 通道，按 kind 分流；
 * 插入后光标自然落在内容之后，连续插入多个文件时顺序不会颠倒。
 * 关键约束：图片 src 必须保持 `@zhai/` 原始引用——显示地址由 ZhaiImage 的 nodeView 转换，
 * 若在这里换成 webview 地址，保存时就会把临时地址写进 Markdown。
 */
import { useEffect } from 'react'
import { isEditorInsertPayload } from '@shared/types/editor'
import { onState } from '@shared/utils/bridge'
import type { Editor } from '@tiptap/react'

export function useEditorInsert(editor: Editor | null): void {
    useEffect(() => {
        if (editor === null) {
            return
        }
        return onState((message) => {
            if (message.channel !== 'editor' || !isEditorInsertPayload(message.payload)) {
                return
            }
            const { image, text } = message.payload
            if (image !== null) {
                editor
                    .chain()
                    .focus()
                    .insertContent({ type: 'image', attrs: { src: image.src, alt: image.alt } })
                    .run()
                return
            }
            if (text !== null) {
                editor.chain().focus().insertContent(text).run()
            }
        })
    }, [editor])
}
