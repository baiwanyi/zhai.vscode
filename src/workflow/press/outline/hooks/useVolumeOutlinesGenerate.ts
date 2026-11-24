/**
 * 生成卷纲：把作品设定快照、人物名单与期望卷数交给宿主 pressAi/aiVolumeOutlines，
 * 取回「卷名 / 预计章节数 / 核心事件 / 主要情节 / 关键转折 / 卷末结果」草案供预览。
 * 复用约定：请求经 @shared/utils/bridge，前端超时略大于宿主侧 120s，保证宿主先给出超时错误；
 * 设定快照复用 utils 的 toSettingSnapshot，与设定字段生成同一份口径。
 * 关键约束：同一时刻只允许一次生成，连点由 ref 拦住；对话框关闭（卸载）时走 abort 接口尽力收口；
 * 草案不落库，是否覆盖卷纲由调用方决定；失败原因统一经 sonner 提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
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

/** 生成参数：期望卷数（0 表示由模型自定）、作品设定与人物名单 */
export interface VolumeOutlinesGenerateOptions {
    volumeCount: number
    setting: ProjectSetting
    characters: readonly CharacterCard[]
    /** 已有卷名：交给模型避免重复，同时提示覆盖语义 */
    existingNames: readonly string[]
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

/** 请求载荷：期望卷数 + 设定快照 + 人物名 + 现有卷名 */
function buildPayload(options: VolumeOutlinesGenerateOptions): VolumeOutlinesGenerateRequest {
    return {
        volumeCount: options.volumeCount,
        existingNames: options.existingNames.filter((name) => name.trim().length > 0),
        setting: toSettingSnapshot(options.setting),
        characters: options.characters.map((character) => character.name),
    }
}
