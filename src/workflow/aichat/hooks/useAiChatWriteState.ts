/**
 * AI 对话写回状态：实时改写目标、可写回与已写回消息，以及逐段预览数据，
 * 经宿主 ai/writeState / ai/writeDiff / ai/applyHunks 三条协议往返。
 * 复用约定：写回成功或宿主广播 writeTarget 后重新拉取，避免本地推断与宿主快照不一致。
 * 关键约束：只回传助手消息 id 与勾选的段索引，不接触文件路径与替换范围；同一时刻只允许一个写回请求；
 * 预览数据用完即清（关闭或写回后置空），避免下次打开时看到上一次的陈旧 diff。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { AiApplyResult, AiWriteDiff, AiWriteState } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '../utils'

/** 写回 hook 的对外依赖：读取失败经由共享提示 hook 经 sonner 上报 */
export interface UseAiChatWriteStateOptions {
    onError: (error: string | null) => void
}

/** 写回状态对外暴露的状态与操作 */
export interface AiChatWriteStateResult {
    writeState: AiWriteState | null
    /** 正在写回的消息 id，用于按钮禁用与文案切换 */
    applyingMessageId: string | null
    /** 逐段预览数据：null 表示未在预览 */
    writeDiff: AiWriteDiff | null
    loadWriteState: () => Promise<void>
    /** 打开逐段预览：只拉取不写回 */
    loadWriteDiff: (messageId: string) => Promise<void>
    /** 关闭预览并清空数据 */
    closeWriteDiff: () => void
    /** 按勾选的段写回 */
    applyHunks: (messageId: string, accepted: number[]) => Promise<void>
    /** 整段写回：等价于接受全部段 */
    applyMessage: (messageId: string) => Promise<void>
}

export function useAiChatWriteState({ onError }: UseAiChatWriteStateOptions): AiChatWriteStateResult {
    const [writeState, setWriteState] = useState<AiWriteState | null>(null)
    const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null)
    const [writeDiff, setWriteDiff] = useState<AiWriteDiff | null>(null)

    const loadWriteState = useCallback(async (): Promise<void> => {
        try {
            setWriteState(await request<AiWriteState>('ai/writeState'))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    /** 打开逐段预览：宿主按消息 id 计算 diff，失败只提示不打开弹窗 */
    const loadWriteDiff = useCallback(async (messageId: string): Promise<void> => {
        try {
            setWriteDiff(await request<AiWriteDiff>('ai/writeDiff', { messageId }))
        } catch (cause) {
            toast.error(toErrorText(cause))
        }
    }, [])

    const closeWriteDiff = useCallback((): void => {
        setWriteDiff(null)
    }, [])

    /** 按勾选段写回：宿主未接受的段保留原文，成功后清空预览并刷新可写回集合 */
    const applyHunks = useCallback(
        async (messageId: string, accepted: number[]): Promise<void> => {
            setApplyingMessageId(messageId)
            try {
                const result = await request<AiApplyResult>('ai/applyHunks', { messageId, accepted })
                onError(null)
                setWriteDiff(null)
                if (result.reason === 'applied') {
                    toast.info(`该回复已应用过：${result.label}`)
                } else {
                    toast.success(`已写入 ${result.label}，可 Ctrl+Z 撤销`)
                }
                setWriteState(await request<AiWriteState>('ai/writeState'))
            } catch (cause) {
                toast.error(toErrorText(cause))
            } finally {
                setApplyingMessageId(null)
            }
        },
        [onError],
    )

    /** 整段写回：不经过预览，宿主按全部段替换 */
    const applyMessage = useCallback(
        async (messageId: string): Promise<void> => {
            setApplyingMessageId(messageId)
            try {
                const result = await request<AiApplyResult>('ai/applyWrite', { messageId })
                onError(null)
                if (result.reason === 'applied') {
                    toast.info(`该回复已应用过：${result.label}`)
                } else {
                    toast.success(`已写入 ${result.label}，可 Ctrl+Z 撤销`)
                }
                setWriteState(await request<AiWriteState>('ai/writeState'))
            } catch (cause) {
                toast.error(toErrorText(cause))
            } finally {
                setApplyingMessageId(null)
            }
        },
        [onError],
    )

    return { writeState, applyingMessageId, writeDiff, loadWriteState, loadWriteDiff, closeWriteDiff, applyHunks, applyMessage }
}
