/**
 * 上下文提交：单条与批量共用同一套「有成功即刷新并关闭、全失败保持打开」的收尾逻辑。
 * 复用约定：请求走 @shared/utils/bridge 的 ai/context/add，失败文案优先取宿主回传的 failed[0].reason；
 * 候选面板与作品面板共用本 hook，对话与生图各自传入作用域，清单互不干扰。
 * 关键约束：提交期间 isSubmitting 为真，压缩类条目可能等待一次模型调用；
 * added 为 0 时不关闭面板，用户可直接重选；请求异常只提示，不吞掉在途标记。
 */
import { useState } from 'react'
import type { AiContextAddItem, AiContextAddResult, AiContextScope } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 提交状态：isSubmitting 供调用方禁用列表，submitItems 供点选与批量添加复用 */
export interface AddContextItemsState {
    isSubmitting: boolean
    submitItems: (items: AiContextAddItem[]) => Promise<void>
}

export function useAddContextItems(
    onAdded: () => void,
    onClose: () => void,
    onError: (error: string) => void,
    /** 作用域：对话按会话隔离，生图固定一份；缺省按对话 */
    scope: AiContextScope = 'chat',
): AddContextItemsState {
    const [isSubmitting, setIsSubmitting] = useState(false)

    const submitItems = async (items: AiContextAddItem[]): Promise<void> => {
        setIsSubmitting(true)
        try {
            const result = await request<AiContextAddResult>('ai/context/add', { items, scope })
            if (result.added === 0) {
                onError(
                    result.failed[0]?.reason ??
                        (result.isFull ? '上下文已达上限，请先移除部分引用' : '该条目已在上下文中'),
                )
                return
            }
            onAdded()
            onClose()
        } catch (cause) {
            onError(toErrorText(cause))
        } finally {
            setIsSubmitting(false)
        }
    }

    return { isSubmitting, submitItems }
}
