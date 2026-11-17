/**
 * 检索输入行：关键词输入即触发检索（200ms 防抖），回车立即触发，供上下文面板与检索弹窗共用。
 * 复用约定：输入组取 @components/ui 的 InputGroup，前缀图标与尾部加载态取 InputGroupAddon，
 * 输入取 InputGroupInput，加载态取 Spinner，图标取 lucide-react。
 * 关键约束：回调用 ref 承接后再进防抖定时器，避免父组件重渲染换掉回调时重发同一关键词；
 * 空串照常上抛（仅由用户输入触发，挂载首帧不上抛），由调用方按「空关键词清空结果」处理，本层不做短路；
 * 输入法组字期间不排定防抖（拼音不是关键词），组字结束后按最终正文补一次；
 * 回车在组字中交给输入法上屏，上一次检索仍在途时忽略连按，避免同一关键词连发；
 * 不再提供检索按钮——防抖已覆盖输入停顿，按钮只会白白占掉一行宽度；
 * 默认不自动聚焦，避免抢走悬停面板触发项的焦点导致面板收起。
 */
import { Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Spinner } from '@components/ui/spinner'
import type { JSX } from 'react'

/** 输入到发请求的间隔：足够容下一次连续输入，又不至于让用户感到延迟 */
const SEARCH_DEBOUNCE_MS = 200

interface AiChatSearchFieldProps {
    /** 检索进行中：尾部显示加载态 */
    isSearching: boolean
    /** 关键词变化时立即上抛（已 trim），空串表示清空检索 */
    onSubmit: (keyword: string) => void
    /** 占位文案：不同面板的检索范围不同，由调用方说明 */
    placeholder?: string
    /** 挂载即聚焦：仅弹窗类场景需要，悬停面板必须保持关闭 */
    autoFocus?: boolean
    /** 外层容器类名：由调用方控制宽度与伸缩，省掉调用处再包一层 div */
    className?: string
}

export function AiChatSearchField({
    isSearching,
    onSubmit,
    placeholder = '输入关键词即时检索',
    autoFocus = false,
    className,
}: AiChatSearchFieldProps): JSX.Element {
    const [keyword, setKeyword] = useState('')
    // 回调随父组件渲染变化，用 ref 承接，避免它进依赖后每次重渲染都重置定时器、重复发同一关键词
    const submitRef = useRef(onSubmit)
    const timerRef = useRef<number | null>(null)
    // 首帧只登记已挂载：关键词还是空串，与调用方初始状态同值，上抛只会换来一次等价请求
    const hasMountedRef = useRef(false)
    // 组字中标记：组字期间的拼音还不是关键词，等 compositionend 拿最终值补发
    const isComposingRef = useRef(false)
    // 组字开始时的正文：组字没改动正文（如按 Esc 取消候选）就不补发，免得重发同一关键词
    const composeStartRef = useRef('')

    useEffect(() => {
        submitRef.current = onSubmit
    }, [onSubmit])

    /** 撤掉待发的防抖：同一关键词只需发一次 */
    const clearTimer = useCallback((): void => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    /** 按给定关键词排一次防抖提交：正文与组字结束两条来源共用一个定时器位，先撤旧再排新 */
    const scheduleSubmit = useCallback(
        (next: string): void => {
            clearTimer()
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null
                submitRef.current(next.trim())
            }, SEARCH_DEBOUNCE_MS)
        },
        [clearTimer],
    )

    useEffect((): (() => void) => {
        const hasMounted = hasMountedRef.current
        hasMountedRef.current = true
        // 首帧不排定；组字中也不排定，等 compositionend 用最终正文补一次
        if (hasMounted && !isComposingRef.current) {
            scheduleSubmit(keyword)
        }
        return clearTimer
    }, [keyword, scheduleSubmit, clearTimer])

    /** 回车立即检索：先撤掉待发的防抖，避免同一关键词连发两次；上一次检索仍在途时忽略连按 */
    const submitNow = (): void => {
        if (isSearching) {
            return
        }
        clearTimer()
        submitRef.current(keyword.trim())
    }

    return (
        <InputGroup className={className}>
            <InputGroupAddon>
                <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
                autoFocus={autoFocus}
                value={keyword}
                placeholder={placeholder}
                aria-label={placeholder}
                aria-busy={isSearching}
                onChange={(event) => setKeyword(event.target.value)}
                onCompositionStart={(event) => {
                    isComposingRef.current = true
                    composeStartRef.current = event.currentTarget.value
                }}
                onCompositionEnd={(event) => {
                    isComposingRef.current = false
                    // 组字没改动正文（如取消候选）就不补发；改动了则按最终正文排一次，替代组字期间被跳过的排定
                    if (event.currentTarget.value === composeStartRef.current) {
                        return
                    }
                    scheduleSubmit(event.currentTarget.value)
                }}
                onKeyDown={(event) => {
                    // 输入法组字中的回车留给输入法确认候选词，否则半截拼音会被当成关键词立刻检索
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                        return
                    }
                    submitNow()
                }}
            />
            {isSearching ? (
                <InputGroupAddon align="inline-end">
                    <Spinner className="size-3.5" aria-label="正在检索" />
                </InputGroupAddon>
            ) : null}
        </InputGroup>
    )
}
