/**
 * 宿主通道状态：挂载时拉一次快照，随后跟随指定通道的状态广播，供「宿主权威状态」的前端镜像复用。
 * 复用 @shared/utils/bridge 的 request / onState，载荷一律经调用方传入的类型守卫收窄，不信任入站数据。
 * 关键约束：广播一定比初始快照新，收到广播后丢弃后到的快照，避免旧值把新值盖回去；
 * 快照失败静默保留初始值（面板刚挂载时宿主可能尚未就绪）；卸载后不再写状态并解除订阅；
 * 只承载「单载荷」通道——同通道多载荷分流、需要就绪态或需要本地乐观覆盖的场景请各自实现，
 * 该差异已写在 ActiveNoteProvider / useWorkflowRouting 的文件头。
 */
import { useEffect, useState } from 'react'
import type { HostMethodName, StateMessage } from '@shared/types/messages'
import { onState, request } from '@shared/utils/bridge'

export interface HostChannelStateOptions<T> {
    /** 快照请求方法名，须与本通道同源 */
    method: HostMethodName
    /** 订阅的状态广播通道 */
    channel: StateMessage['channel']
    /** 载荷类型守卫：不合形态的快照与广播一律丢弃 */
    isValid: (payload: unknown) => payload is T
    /** 快照与广播都未到达时的初始值 */
    initial: T
    /**
     * 落值前的等价判定：返回 true 表示语义未变，跳过本次更新。
     * 宿主每次广播都是新对象，按字段比较可省掉「内容相同」造成的重渲染。
     * 必须传稳定引用（模块级函数或 useCallback），否则每次渲染都会解除并重建订阅。
     */
    isEqual?: (previous: T, next: T) => boolean
}

export function useHostChannelState<T>(options: HostChannelStateOptions<T>): T {
    const { channel, initial, isEqual = Object.is, isValid, method } = options
    const [value, setValue] = useState<T>(initial)

    useEffect(() => {
        let isDisposed = false
        /** 是否已收到广播：广播一定比初始快照新，收到后丢弃后到的快照 */
        let hasBroadcast = false
        /** 语义等价时不改引用，让 React 跳过这一轮重渲染 */
        const commit = (next: T): void => {
            setValue((previous) => (isEqual(previous, next) ? previous : next))
        }
        const loadSnapshot = async (): Promise<void> => {
            try {
                const snapshot: unknown = await request(method)
                if (!isDisposed && !hasBroadcast && isValid(snapshot)) {
                    commit(snapshot)
                }
            } catch {
                // 宿主未就绪时保留初始值，等广播回填；此处不打断页面
            }
        }
        void loadSnapshot()
        const unsubscribe = onState((message) => {
            if (message.channel !== channel || !isValid(message.payload)) {
                return
            }
            hasBroadcast = true
            commit(message.payload)
        })
        return (): void => {
            isDisposed = true
            unsubscribe()
        }
    }, [channel, isEqual, isValid, method])

    return value
}
