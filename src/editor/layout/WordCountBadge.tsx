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
    return editor.state.doc.textContent.replace(/\s/g, '').length
}

export interface WordCountBadgeProps {
    editor: Editor | null
}

export function WordCountBadge({ editor }: WordCountBadgeProps): JSX.Element | null {
    const [count, setCount] = useState(0)

    useEffect(() => {
        if (editor === null) {
            return
        }
        let timer: ReturnType<typeof setTimeout> | null = null
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
                setCount(countChars(editor))
            }, COUNT_DEBOUNCE_MS)
        }
        // 首次统计放到下一帧：effect 内同步 setState 会多一次渲染，也留出正文灌入的时间
        const frame = requestAnimationFrame((): void => {
            setCount(countChars(editor))
        })
        editor.on('transaction', recount)
        return (): void => {
            cancelAnimationFrame(frame)
            editor.off('transaction', recount)
            if (timer !== null) {
                clearTimeout(timer)
            }
        }
    }, [editor])

    if (editor === null) {
        return null
    }

    return (
        <span className="pointer-events-none absolute right-4 bottom-4 tabular-nums opacity-80 font-light text-xl italic">
            {count.toLocaleString('zh-CN')}
        </span>
    )
}
