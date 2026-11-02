/**
 * 连续生成授权：判定一条已拼装的正文是否属于「一次写多章」意图，命中则挂起等待授权，
 * 确认后本轮以 autoApprove 发出，授权只对这一次发送生效。
 * 复用约定：意图粗筛取 ../utils 的 wantsContinuousGeneration，发送函数由会话 hook 注入，
 * 发送成功后的收尾（清空命令）经 onSent 上抛，本 hook 不持有命令状态。
 * 关键约束：只有写入范围为 project 时才需要授权，其余范围直接发送；
 * 授权不放宽任何权限边界，只为减少逐个文件确认；挂起期间再次触发发送即覆盖挂起项，不排队。
 */
import { useCallback, useState } from 'react'
import type { AiWriteGrant } from '@shared/types/aiChat'
import type { AiSendOptions } from './useAiChatSession'
import { wantsContinuousGeneration } from '../utils'

/** 待确认的连续生成请求：非空时弹一次「本轮直接写入」授权框 */
export interface PendingAutoApprove {
    content: string
    titleHint: string | undefined
}

/** 提交发送时需要透传给会话 hook 的上下文 */
export interface AutoApproveSubmitOptions {
    /** 当前写入授权范围：project 才会触发连续生成授权 */
    writeGrant: AiWriteGrant
    /** 命令名称等展示用短标题 */
    titleHint?: string
}

/** 连续生成授权 hook 的对外依赖 */
export interface UseAiChatAutoApproveOptions {
    send: (content: string, options?: AiSendOptions) => Promise<boolean>
    /** 发送成功后的收尾：由调用方清空已选命令 */
    onSent: () => void
}

/** 连续生成授权对外暴露的状态与操作 */
export interface AiChatAutoApproveState {
    pending: PendingAutoApprove | null
    /** 发送入口：连续生成先挂起等授权，其余直接发出 */
    submit: (content: string, options: AutoApproveSubmitOptions) => Promise<void>
    confirm: () => void
    dismiss: () => void
}

export function useAiChatAutoApprove({ send, onSent }: UseAiChatAutoApproveOptions): AiChatAutoApproveState {
    const [pending, setPending] = useState<PendingAutoApprove | null>(null)

    const submit = useCallback(
        async (content: string, options: AutoApproveSubmitOptions): Promise<void> => {
            // 连续生成先取得一次授权：否则每写一个文件都要弹一次确认
            if (options.writeGrant === 'project' && wantsContinuousGeneration(content)) {
                setPending({ content, titleHint: options.titleHint })
                return
            }
            const isSent = await send(content, { titleHint: options.titleHint })
            if (isSent) {
                onSent()
            }
        },
        [onSent, send],
    )

    /** 授权确认：授权只对这一次发送生效，挂起项立即清空 */
    const confirm = useCallback((): void => {
        const current = pending
        setPending(null)
        if (current === null) {
            return
        }
        void send(current.content, { autoApprove: true, titleHint: current.titleHint }).then((isSent) => {
            if (isSent) {
                onSent()
            }
        })
    }, [onSent, pending, send])

    const dismiss = useCallback((): void => {
        setPending(null)
    }, [])

    return { pending, submit, confirm, dismiss }
}
