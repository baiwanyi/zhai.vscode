/**
 * 生成卷纲：设定快照、人物、已有卷名与全书结构阶段交给宿主，取回卷纲草案供预览。
 * 复用约定：请求取 @shared/utils/bridge，设定快照取 ../../utils 的 toSettingSnapshot。
 * 关键约束：前端超时略大于宿主侧；同一时刻仅一次生成，卸载走 abort；草案不落库，失败经 sonner 提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    OutlineActContext,
    VolumeOutlineDraft,
    VolumeOutlinesGenerateRequest,
    VolumeOutlinesGenerateResult,
} from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { CharacterCard, ProjectSetting } from '../../types'
import { toSettingSnapshot } from '../../utils'

/** AI 通道前端超时：略大于宿主 120s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 140_000

/** 生成参数：期望卷数、作品设定、人物名单与全书结构阶段 */
export interface VolumeOutlinesGenerateOptions {
    volumeCount: number
    setting: ProjectSetting
    characters: readonly CharacterCard[]
    /** 已有卷名：交给模型避免重复，同时提示覆盖语义 */
    existingNames: readonly string[]
    /** 结构阶段：作为分卷转折约束，不改写期望卷数 */
    acts: readonly OutlineActContext[]
}

export interface VolumeOutlinesGenerateState {
    isGenerating: boolean
    /** 生成成功返回草案，失败或取消返回 null（原因已提示） */
    generate: (options: VolumeOutlinesGenerateOptions) => Promise<VolumeOutlineDraft[] | null>
    abort: () => Promise<void>
}

export function useVolumeOutlinesGenerate(): VolumeOutlinesGenerateState {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 同步标记：setState 生效前的连点会被这里拦住 */
    const generatingRef = useRef(false)

    const generate = useCallback(
        async (options: VolumeOutlinesGenerateOptions): Promise<VolumeOutlineDraft[] | null> => {
            if (generatingRef.current) {
                return null
            }
            generatingRef.current = true
            setIsGenerating(true)
            try {
                const result = await request<VolumeOutlinesGenerateResult>(
                    'pressAi/aiVolumeOutlines',
                    buildPayload(options),
                    AI_REQUEST_TIMEOUT_MS,
                )
                if (result.volumes.length === 0) {
                    toast.error('AI 未返回可用的卷纲，请先补全作品设定后重试')
                    return null
                }
                return result.volumes
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                generatingRef.current = false
                setIsGenerating(false)
            }
        },
        [],
    )

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiVolumeOutlines/abort')
        } catch {
            // 取消属于尽力而为：宿主没有在途请求或已结束时忽略错误
        }
    }, [])

    // 对话框卸载（关闭）时取消在途请求，避免结果无人接收却仍消耗配额
    useEffect(() => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { isGenerating, generate, abort }
}

/** 请求载荷：期望卷数 + 设定快照 + 人物名 + 现有卷名 + 结构阶段 */
function buildPayload(options: VolumeOutlinesGenerateOptions): VolumeOutlinesGenerateRequest {
    return {
        volumeCount: options.volumeCount,
        existingNames: options.existingNames.filter((name) => name.trim().length > 0),
        acts: [...options.acts],
        setting: toSettingSnapshot(options.setting),
        characters: options.characters.map((character) => character.name),
    }
}
