/**
 * 条目描述生成：把条目身份、草稿与整份设定拼成快照交给宿主 pressAi/aiLoreDescription，取回可直接写入描述的正文。
 * 复用约定：请求经 @shared/utils/bridge，前端超时略大于宿主侧 45s，保证宿主先给出超时错误；
 * 分类白名单与快照字段来自 shared/types/press，提示词与清洗都在宿主侧完成。
 * 关键约束：同一时刻只允许一项生成，弹窗关闭（卸载）时走 pressAi/aiLoreDescription/abort 尽力收口；
 * 结果不落库，由调用方写入弹窗草稿，保存时才写盘。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { LoreDescriptionGenerateRequest, LoreDescriptionGenerateResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** AI 通道前端超时：略大于宿主 45s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 55_000

export interface LoreDescriptionGenerateState {
    /** 是否有在途请求：驱动光晕、按钮转圈，并禁用同弹窗内的出图按钮 */
    isGenerating: boolean
    /** 生成条目描述：成功返回正文，失败返回 null（失败原因已由 sonner 提示） */
    generate: (payload: LoreDescriptionGenerateRequest) => Promise<string | null>
    abort: () => Promise<void>
}

export function useLoreDescriptionGenerate(): LoreDescriptionGenerateState {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 同步标记：setState 生效前的连点会被这里拦住，保证同一时刻只有一项在生成 */
    const activeRef = useRef(false)

    const generate = useCallback(async (payload: LoreDescriptionGenerateRequest): Promise<string | null> => {
        if (activeRef.current) {
            return null
        }
        activeRef.current = true
        setIsGenerating(true)
        try {
            const result = await request<LoreDescriptionGenerateResult>(
                'pressAi/aiLoreDescription',
                payload,
                AI_REQUEST_TIMEOUT_MS,
            )
            if (result.content.length === 0) {
                toast.error('AI 未返回可用内容，请重试或手动填写')
                return null
            }
            return result.content
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            activeRef.current = false
            setIsGenerating(false)
        }
    }, [])

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiLoreDescription/abort')
        } catch {
            // 取消属于尽力而为：宿主无进行中请求或已结束时忽略错误
        }
    }, [])

    // 弹窗关闭即卸载，取消在途请求，避免结果无人接收却仍消耗配额
    useEffect(() => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { isGenerating, generate, abort }
}
