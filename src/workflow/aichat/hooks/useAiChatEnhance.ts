/**
 * 对话提示词增强：封装宿主改写请求的进行态与失败提示，供输入卡片上抛。
 * 复用约定：协议 ai/enhancePrompt 走文本通道改写，按当前会话模式选择写作 / 对话口径；
 * 前端兜底超时取宿主上限的两倍，避免前端先于宿主判超时。
 * 关键约束：只回传改写文本，不持有输入框状态——原文保存与还原由输入卡片负责；
 * 失败或空输入返回 null（并提示原因），调用方据此保持原文不动。
 */
import { useCallback, useState } from 'react'
import type { AiConversationMode } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 增强兜底超时：宿主 30 秒上限，前端留一倍余量 */
const ENHANCE_TIMEOUT_MS = 60_000

interface UseAiChatEnhanceResult {
    /** 增强请求进行中：输入卡片的按钮转圈并丢弃重复点击 */
    isEnhancing: boolean
    /** 请求改写：返回改写后的文本，空输入或失败返回 null */
    enhance: (text: string, mode: AiConversationMode) => Promise<string | null>
}

export function useAiChatEnhance(): UseAiChatEnhanceResult {
    const [isEnhancing, setIsEnhancing] = useState(false)

    const enhance = useCallback(async (text: string, mode: AiConversationMode): Promise<string | null> => {
        const source = text.trim()
        if (source.length === 0) {
            return null
        }
        setIsEnhancing(true)
        try {
            const result = await request<{ text: string }>(
                'ai/enhancePrompt',
                { text: source, mode },
                ENHANCE_TIMEOUT_MS,
            )
            return result.text
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            setIsEnhancing(false)
        }
    }, [])

    return { isEnhancing, enhance }
}
