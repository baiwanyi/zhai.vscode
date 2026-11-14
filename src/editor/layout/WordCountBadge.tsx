/**
 * 右下角字数：实时显示当前文档的字数（去空白后的字符数，只显示数字，不带单位）。
 * 复用约定：不套容器组件，直接用 span 承担定位、等宽数字与弱化透明度；统计逻辑留在本组件内，不新增公共工具；
 * 统计口径与宿主 countWords 的最终口径一致（正文已是富文本，无需再剥 Markdown 标记）。
 * 关键约束：订阅 editor 的 transaction（只看 docChanged）就地更新，不把字数提到 EditorScreen 让整屏重渲染；
 * 宿主灌正文走 emitUpdate: false，只听 update 会漏掉加载完成那次；长文档按键频繁，
 * 统计按 300ms 防抖合并，输入停顿后才遍历一次正文。
 */
import { useEffect, useState } from 'react'
import type { Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import type { JSX } from 'react'

/** 统计防抖：比回写防抖（500ms）略快，输入一停顿就能看到最新字数，连续输入时不做无谓的全量遍历 */
const COUNT_DEBOUNCE_MS = 300

/** 字数口径：去空白字符数，与宿主统计保持一致（含标点） */
function countChars(editor: Editor): number {
    // 逐文本节点累加，不拼全文再替换：长文档下 textContent 与 replace 各分配一份全文大小的字符串
    let total = 0
    editor.state.doc.descendants((node): void => {
        if (node.isText && node.text !== undefined) {
            total += node.text.replace(/\s/g, '').length
        }
    })
    return total
}

export interface WordCountBadgeProps {
    editor: Editor | null
}

export function WordCountBadge({ editor }: WordCountBadgeProps): JSX.Element | null {
    // null 表示尚未统计：与真实 0 字区分开，避免快照灌入前先闪一个「0」
    const [count, setCount] = useState<number | null>(null)

    useEffect(() => {
        if (editor === null) {
            return
        }
        let timer: ReturnType<typeof setTimeout> | null = null
        // 空正文不落值：快照灌入前先统计到 0 会把「0」当成真实字数显示出来
        const measure = (): void => {
            setCount(editor.state.doc.content.size === 0 ? null : countChars(editor))
        }
        // 正文有变化才重新统计：宿主灌正文用的是 emitUpdate: false，只听 update 会漏掉加载完成这一次
        const recount = (event: { transaction: Transaction }): void => {
            if (!event.transaction.docChanged) {
                return
            }
            if (timer !== null) {
                clearTimeout(timer)
            }
            timer = setTimeout((): void => {
                timer = null
                measure()
            }, COUNT_DEBOUNCE_MS)
        }
        // 首次数用定时器而不是 rAF：webview 不可见时 rAF 不执行，effect 内同步 setState 又会多一次渲染
        const initialTimer = setTimeout(measure, 0)
        editor.on('transaction', recount)
        return (): void => {
            clearTimeout(initialTimer)
            editor.off('transaction', recount)
            if (timer !== null) {
                clearTimeout(timer)
            }
        }
    }, [editor])

    if (editor === null || count === null) {
        return null
    }

    return (
        <span className="pointer-events-none absolute right-4 bottom-4 tabular-nums opacity-80 font-light text-xl italic">
            {count.toLocaleString('zh-CN')}
        </span>
    )
}
