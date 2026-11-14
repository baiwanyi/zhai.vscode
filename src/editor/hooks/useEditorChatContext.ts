/**
 * 加入 AI 对话：把选中文本与块序号交给宿主换算成 Markdown 行范围，写入对话上下文。
 * 复用约定：行号换算、引用生成、去重与条数上限都在宿主侧，本 hook 只负责请求与提示。
 * 关键约束：请求前必须先 flush——防抖未结束时宿主快照还是旧的，行号会指向改动前的位置；
 * 只有宿主回的业务错误（HostRequestError）可以原样展示，内部异常（序列化失败、超时）给固定文案。
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import type { EditorChatContextRequest, EditorChatContextResult } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'
import { toHostErrorText } from '@shared/utils/errorText'

/** 失败兜底：宿主回的 reason 缺失或为空串时，提示条不能没有文字 */
const MESSAGE_ADD_CHAT_FAILED = '未能添加到 AI 对话'

export interface UseEditorChatContextResult {
    /** 加入对话：blockIndex 为选区起点块，endBlockIndex 缺省表示只引用单块 */
    addToChat: (quote: string, blockIndex: number, endBlockIndex?: number) => Promise<void>
}

export function useEditorChatContext(flush: () => Promise<boolean>): UseEditorChatContextResult {
    /**
     * 加入宅对话：块菜单只传当前块；选区工具条会带上终点块序号，把选中的多行整段纳入引用。
     * 这里只负责请求与提示——行号换算、引用生成、去重与条数上限都在宿主侧判断，避免两处各算一套。
     */
    const addToChat = useCallback(
        async (quote: string, blockIndex: number, endBlockIndex?: number): Promise<void> => {
            try {
                // 先把防抖窗口里的输入回写进 TextDocument：宿主要按最新快照的块偏移换算行号
                await flush()
                // 未给终点块时只引用单块：块菜单入口不传，选区入口按选中行给出的起止块传
                const payload: EditorChatContextRequest =
                    endBlockIndex === undefined ? { quote, blockIndex } : { quote, blockIndex, endBlockIndex }
                const result = await request<EditorChatContextResult>('editor/chat/context', payload)
                if (result.added) {
                    toast.success(result.label === undefined ? '已添加到 AI 对话' : `已添加到 AI 对话：${result.label}`)
                    return
                }
                // 宿主可能回空字符串：空文案的提示条等于没提示
                toast.warning(
                    result.reason !== undefined && result.reason.length > 0 ? result.reason : MESSAGE_ADD_CHAT_FAILED,
                )
            } catch (reason) {
                // 只有宿主回的业务错误可以原样展示，内部异常（序列化失败、超时）一律给固定文案
                toast.error(toHostErrorText(reason, MESSAGE_ADD_CHAT_FAILED))
            }
        },
        [flush],
    )

    return { addToChat }
}
