/**
 * AI 对话写回状态：实时改写目标、可写回与已写回消息，经宿主 ai/writeState 与 ai/applyWrite 往返。
 * 复用约定：写回成功或宿主广播 writeTarget 后重新拉取，避免本地推断与宿主快照不一致。
 * 关键约束：只回传助手消息 id 执行写回，不接触文件路径与替换范围；同一时刻只允许一个写回请求。
 */
import { useCallback, useState } from 'react'
import type { AiApplyResult, AiWriteState } from '@shared/types/aiChat'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 写回 hook 的对外依赖：错误与提示由共享提示 hook 持有 */
export interface UseAiChatWriteStateOptions {
    onError: (error: string | null) => void
    onNotice: (notice: string | null) => void
}

/** 写回状态对外暴露的状态与操作 */
export interface AiChatWriteStateResult {
    writeState: AiWriteState | null
    /** 正在写回的消息 id，用于按钮禁用与文案切换 */
    applyingMessageId: string | null
    loadWriteState: () => Promise<void>
    applyMessage: (messageId: string) => Promise<void>
}

export function useAiChatWriteState({ onError, onNotice }: UseAiChatWriteStateOptions): AiChatWriteStateResult {
    const [writeState, setWriteState] = useState<AiWriteState | null>(null)
    const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null)

    const loadWriteState = useCallback(async (): Promise<void> => {
        try {
            setWriteState(await request<AiWriteState>('ai/writeState'))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    /** 把指定助手消息写回编辑栏：宿主校验版本与归属，成功后刷新可写回集合 */
    const applyMessage = useCallback(
        async (messageId: string): Promise<void> => {
            setApplyingMessageId(messageId)
            try {
                const result = await request<AiApplyResult>('ai/applyWrite', { messageId })
                onNotice(
                    result.reason === 'applied'
                        ? `该回复已应用过：${result.label}`
                        : `已写入 ${result.label}，可 Ctrl+Z 撤销`,
                )
                onError(null)
                setWriteState(await request<AiWriteState>('ai/writeState'))
            } catch (cause) {
                onError(toErrorText(cause))
            } finally {
                setApplyingMessageId(null)
            }
        },
        [onError, onNotice],
    )

    return { writeState, applyingMessageId, loadWriteState, applyMessage }
}
