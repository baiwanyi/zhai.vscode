/**
 * 复制按钮：复制传入的纯文本，成功后把图标换成对勾并短暂停留。
 * 复用约定：剪贴板走 @shared/utils/clipboard，失败用 sonner 提示，按钮与图标尺寸取 @webview/components/Button。
 * 关键约束：连点要重置提示起点，卸载必须清掉计时器，回调不能落到已卸载的组件上；
 * 提示态只改图标与 tooltip，不改按钮宽度，避免工具条在点击瞬间重排。
 */
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { copyToClipboard } from '@shared/utils/clipboard'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 复制成功提示的停留时长 */
const COPIED_HINT_MS = 1200

export interface CopyButtonProps {
    /** 要复制的纯文本：由调用方冻结，不在点击时现读选区 */
    text: string
}

export function CopyButton({ text }: CopyButtonProps): JSX.Element {
    const [isCopied, setIsCopied] = useState(false)
    // 复制提示的计时器：连点要重置起点，卸载要清掉
    const copyTimerRef = useRef<number | null>(null)
    // 是否仍挂载：await 期间工具条可能因换选区被卸载，回调不能再碰已卸载的状态与计时器
    const isMountedRef = useRef(true)

    useEffect((): (() => void) => {
        // StrictMode 会 mount → cleanup → mount，这里必须显式复位，否则第二次挂载后复制全被拦掉
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current)
                copyTimerRef.current = null
            }
        }
    }, [])

    const handleCopy = async (): Promise<void> => {
        const isOk = await copyToClipboard(text)
        if (!isMountedRef.current) {
            return
        }
        if (!isOk) {
            toast.error('复制失败，请检查剪贴板权限')
            return
        }
        setIsCopied(true)
        // 连点会重复排队：先清旧计时，提示从最后一次点击起算
        if (copyTimerRef.current !== null) {
            window.clearTimeout(copyTimerRef.current)
        }
        copyTimerRef.current = window.setTimeout((): void => {
            copyTimerRef.current = null
            setIsCopied(false)
        }, COPIED_HINT_MS)
    }

    return (
        <Button
            variant="ghost"
            size="icon-sm"
            tooltip={isCopied ? '已复制' : '复制'}
            aria-label={isCopied ? '已复制' : '复制'}
            onClick={(): void => void handleCopy()}
        >
            {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
    )
}
