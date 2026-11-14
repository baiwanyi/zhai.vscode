/**
 * 正文链接的 Ctrl/Cmd + 点击：按点击坐标反查链接 mark 后交给宿主打开。
 * 复用约定：地址只经 bridge 的 request('editor/openLink') 上送，宿主侧还会再做一次协议白名单校验。
 * 关键约束：链接元素已被 CSS 关掉指针命中，单击打不到 a 上，只能按坐标反查；
 * 前端先按同一套协议预检，非 http(s)/mailto 直接提示，不发无谓请求；
 * 打开失败必须说出来，不能静默吞掉；监听挂在 document 捕获阶段，卸载必须摘除。
 */
import { useEffect } from 'react'
import { toast } from 'sonner'
import { request } from '@shared/utils/bridge'
import { isOpenableUrl } from '@shared/utils/url'
import type { Editor } from '@tiptap/react'

/** 非白名单协议的提示：宿主同样会拒绝，这里提前说清楚，避免点了没反应 */
const MESSAGE_UNSUPPORTED_LINK = '仅支持 http(s)、mailto 链接'

/** 打开失败兜底：系统打开器拒绝时不解释原因，只告诉用户没打开 */
const MESSAGE_OPEN_FAILED = '链接未能打开'

export function useEditorLinkClick(editor: Editor | null): void {
    useEffect(() => {
        if (editor === null) {
            return
        }
        const handleClick = (event: Event): void => {
            if (!(event instanceof globalThis.MouseEvent)) {
                return
            }
            if (!event.ctrlKey && !event.metaKey) {
                return
            }
            const linkType = editor.schema.marks.link
            if (linkType === undefined) {
                return
            }
            const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (at === null) {
                return
            }
            const resolved = editor.state.doc.resolve(at.pos)
            const mark = linkType.isInSet(resolved.marks())
            if (mark === undefined) {
                return
            }
            // attrs 在 ProseMirror 里是 any：先收窄成 unknown 字典，避免整段被 unsafe-* 规则牵连
            const attributes: Record<string, unknown> = mark.attrs
            const href = attributes.href
            if (typeof href !== 'string' || href.length === 0) {
                return
            }
            if (!isOpenableUrl(href)) {
                toast.error(MESSAGE_UNSUPPORTED_LINK)
                return
            }
            void request('editor/openLink', { url: href }).catch((): void => {
                toast.error(MESSAGE_OPEN_FAILED)
            })
        }
        document.addEventListener('click', handleClick, true)
        return (): void => {
            document.removeEventListener('click', handleClick, true)
        }
    }, [editor])
}
