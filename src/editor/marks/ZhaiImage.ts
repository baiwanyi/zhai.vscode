/**
 * 图片节点：显示时把 `@zhai/` 引用换成 webview 可访问地址，序列化时保留原始引用。
 * 复用约定：继承 Tiptap Image 的 schema 与解析规则（`img[src]`），只覆盖 nodeView；
 * renderHTML 沿用父类默认实现，所以 `getHTML()` 输出的永远是 `@zhai/...`，回写 Markdown 不会带上临时地址。
 * 关键约束：nodeView 返回 leaf DOM（无 contentDOM），样式必须内联——节点视图由 ProseMirror 直接插 DOM，
 * 不在 React 树里，Tailwind 类不会进产物；assetPrefix 未就绪时先渲染原值，订阅到前缀后再修正。
 */
import Image from '@tiptap/extension-image'
import { resolveAssetUrl, subscribeAssetPrefix } from './imageAsset'
import type { NodeViewRenderer } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 图片展示样式：块级留白 + 限宽，与正文缩进对齐 */
const IMAGE_STYLE = 'max-width:100%;height:auto;border-radius:4px;display:block;margin:10px 0;'

export const ZhaiImage = Image.extend({
    addNodeView(): NodeViewRenderer {
        return ({ node }): { dom: HTMLElement; update: (next: ProseMirrorNode) => boolean; destroy: () => void } => {
            const image = document.createElement('img')
            image.style.cssText = IMAGE_STYLE
            let current = node
            const render = (): void => {
                image.src = resolveAssetUrl(String(current.attrs.src ?? ''))
                image.alt = String(current.attrs.alt ?? '')
            }
            render()
            const unsubscribe = subscribeAssetPrefix(render)
            return {
                dom: image,
                update: (next): boolean => {
                    current = next
                    render()
                    return true
                },
                destroy: (): void => {
                    unsubscribe()
                },
            }
        }
    },
})
