/**
 * 工具审批队列：订阅宿主推送的待确认事项，按到达顺序逐条交给弹窗，用户的决定经 ai/permissionDecision 回传。
 * 复用约定：错误统一经调用方注入的 onError 上报；队列只保存宿主生成的 id，不解析工具入参。
 * 关键约束：流末必须清空剩余条目（宿主已拒绝全部等待），否则弹窗会停在已失效的事项上；
 * 同 id 重复推送要忽略，避免模型重试时同一条审批被排两次。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'
import { onStream, request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 审批队列的对外依赖：错误经共享提示 hook 上报 */
export interface UseAiChatPermissionOptions {
    onError: (error: string | null) => void
}

/** 审批队列对外暴露的状态与操作 */
export interface AiChatPermissionState {
    /** 队首待确认事项：null 表示当前无需用户决策 */
    pending: AiPermissionRequest | null
    /** 提交决定：先出队再回传，失败只提示不重试 */
    respond: (decision: AiPermissionDecision) => Promise<void>
}

export function useAiChatPermission({ onError }: UseAiChatPermissionOptions): AiChatPermissionState {
    const [queue, setQueue] = useState<AiPermissionRequest[]>([])
    /** 队首快照：respond 用它取当前事项，避免把整个队列塞进依赖导致回调频繁重建 */
    const queueRef = useRef<AiPermissionRequest[]>([])

    useEffect(() => {
        queueRef.current = queue
    }, [queue])

    useEffect(() => {
        return onStream((message) => {
            const incoming = message.permission
            if (incoming !== undefined) {
                setQueue((previous) =>
                    previous.some((item) => item.id === incoming.id) ? previous : [...previous, incoming],
                )
                return
            }
            if (message.done) {
                // 宿主在流末拒绝全部等待中的审批，前端队列必须同步清空
                setQueue([])
            }
        })
    }, [])

    const respond = useCallback(
        async (decision: AiPermissionDecision): Promise<void> => {
            const current = queueRef.current[0]
            if (current === undefined) {
                return
            }
            setQueue((previous) => previous.slice(1))
            try {
                await request('ai/permissionDecision', { id: current.id, decision })
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError],
    )

    return { pending: queue[0] ?? null, respond }
}
