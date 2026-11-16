/**
 * 检索输入行：关键词输入即触发检索（200ms 防抖），回车与按钮立即触发，供上下文面板与检索弹窗共用。
 * 复用约定：输入取 @components/ui/input，按钮取 @webview/components/Button；
 * 关键词草稿只存在本层，弹窗关闭后随内容区一并卸载，不会残留上一轮的关键词。
 * 关键约束：回调用 ref 承接后再进防抖定时器，避免父组件重渲染换掉回调时重发同一关键词；
 * 空串照常上抛，由调用方按「空关键词清空结果」处理，本层不做短路。
 */
import { useEffect, useRef, useState } from 'react'
import { Input } from '@components/ui/input'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 输入到发请求的间隔：足够容下一次连续输入，又不至于让用户感到延迟 */
const SEARCH_DEBOUNCE_MS = 200

interface AiChatSearchFieldProps {
    /** 检索进行中：按钮展示加载文案并禁用 */
    isSearching: boolean
    /** 关键词变化时立即上抛（已 trim），空串表示清空检索 */
    onSubmit: (keyword: string) => void
    /** 占位文案：不同面板的检索范围不同，由调用方说明 */
    placeholder?: string
}

export function AiChatSearchField({
    isSearching,
    onSubmit,
    placeholder = '输入关键词即时检索',
}: AiChatSearchFieldProps): JSX.Element {
    const [keyword, setKeyword] = useState('')
    // 回调随父组件渲染变化，用 ref 承接，避免它进依赖后每次重渲染都重置定时器、重复发同一关键词
    const submitRef = useRef(onSubmit)
    const timerRef = useRef<number | null>(null)

    useEffect(() => {
        submitRef.current = onSubmit
    }, [onSubmit])

    useEffect((): (() => void) => {
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            submitRef.current(keyword.trim())
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [keyword])

    /** 立即检索：回车与按钮走这条，先撤掉待发的防抖，避免同一关键词连发两次 */
    const submitNow = (): void => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        submitRef.current(keyword.trim())
    }

    return (
        <div className="flex items-center gap-2">
            <Input
                autoFocus
                value={keyword}
                placeholder={placeholder}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        submitNow()
                    }
                }}
            />
            <Button variant="secondary" disabled={isSearching} onClick={submitNow}>
                {isSearching ? '检索中…' : '检索'}
            </Button>
        </div>
    )
}
