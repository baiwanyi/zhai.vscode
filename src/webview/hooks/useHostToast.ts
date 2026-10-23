/**
 * 宿主操作反馈订阅：把宿主经 state 广播下发的 toast 载荷转成 sonner 提示。
 * 复用约定：两个 Webview 根各挂一次，页面内不再各自订阅宿主反馈，避免同一条提示重复弹出。
 * 关键约束：只处理 channel 为 toast 的广播，载荷经 isToastPayload 收窄后再展示；
 * 级别到 sonner 方法的映射用索引调用，保持 toast 对象的方法绑定不变。
 */
import { useEffect } from 'react'
import { toast } from 'sonner'
import { isToastPayload } from '@shared/types/messages'
import { onState } from '../bridge'

export function useHostToast(): void {
    useEffect(
        () =>
            onState((message) => {
                if (message.channel !== 'toast' || !isToastPayload(message.payload)) {
                    return
                }
                const { level, message: text } = message.payload
                toast[level](text)
            }),
        [],
    )
}
