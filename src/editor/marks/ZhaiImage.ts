/**
 * 图片节点：显示时把 `@zhai/` 引用换成 webview 可访问地址，序列化时保留原始引用。
 * 复用约定：继承 Tiptap Image 的 schema 与解析规则（`img[src]`），只覆盖 nodeView；
 * renderHTML 沿用父类默认实现，所以 `getHTML()` 输出的永远是 `@zhai/...`，回写 Markdown 不会带上临时地址。
 * 关键约束：nodeView 返回 leaf DOM（无 contentDOM），这里不写内联样式——内联会压过
 * editor.css 里的 `img` 规则，改主题时怎么调都不生效；尺寸与圆角统一由那份 CSS 提供。
 * assetPrefix 未就绪时先渲染原值，订阅到前缀后再修正。
 */
import Image from '@tiptap/extension-image'
import { resolveAssetUrl, subscribeAssetPrefix } from './imageAsset'
import type { NodeViewRenderer } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export const ZhaiImage = Image.extend({
    addNodeView(): NodeViewRenderer {
        return ({ node }): { dom: HTMLElement; update: (next: ProseMirrorNode) => boolean; destroy: () => void } => {
            const image = document.createElement('img')
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
