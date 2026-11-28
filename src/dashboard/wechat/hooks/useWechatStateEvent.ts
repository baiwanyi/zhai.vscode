/**
 * 公众号通道广播订阅：只认 wechat 通道且载荷通过类型守卫的事件，卸载时自动退订。
 * 复用约定：订阅原语取 shared/utils/bridge 的 onState，通道与守卫判断收拢一处；
 * 鉴权失效与推送阶段等事件各自定义守卫与处理函数，本 hook 不感知具体事件形状。
 * 关键约束：守卫与处理函数必须稳定（模块函数或 useCallback），否则每次渲染都会重复订阅；
 * 非 wechat 通道与守卫不通过的载荷一律忽略。
 */
import { useEffect } from 'react'
import { onState } from '@shared/utils/bridge'

export function useWechatStateEvent<T>(
    guard: (payload: unknown) => payload is T,
    handler: (payload: T) => void,
): void {
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'wechat' || !guard(message.payload)) {
                return
            }
            handler(message.payload)
        })
    }, [guard, handler])
}
