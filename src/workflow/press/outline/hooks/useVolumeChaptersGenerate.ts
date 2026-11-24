/**
 * 按卷生成章纲：卷纲、全书结构、本卷伏笔与设定快照交给宿主，取回含伏笔关联的章纲草案。
 * 复用约定：请求取 @shared/utils/bridge，设定快照取 ../../utils 的 toSettingSnapshot。
 * 关键约束：前端超时略大于宿主侧；同一时刻仅一次生成，卸载走 abort；草案不落库，失败经 sonner 提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    OutlineActContext,
    OutlineClueContext,
    VolumeChapterDraft,
    VolumeChaptersGenerateRequest,
    VolumeChaptersGenerateResult,
} from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import { toSettingSnapshot } from '../../utils'

/** AI 通道前端超时：略大于宿主 180s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 200_000

export interface VolumeChaptersGenerateState {
    isGenerating: boolean
    /** 生成成功返回草案，失败或取消返回 null（原因已提示） */
    generate: (
        volume: OutlineVolume,
        setting: ProjectSetting,
        characters: readonly CharacterCard[],
        options: VolumeChaptersGenerateOptions,
    ) => Promise<VolumeChapterDraft[] | null>
    abort: () => Promise<void>
}

/** 生成参数：章序范围由写入方式算出，结构阶段与本卷伏笔由页面装配 */
export interface VolumeChaptersGenerateOptions {
    startOrder: number
    chapterCount: number
    existingCount: number
    acts: readonly OutlineActContext[]
    clues: readonly OutlineClueContext[]
}

export function useVolumeChaptersGenerate(): VolumeChaptersGenerateState {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 同步标记：setState 生效前的连点会被这里拦住 */
    const generatingRef = useRef(false)

    const generate = useCallback(
        async (
            volume: OutlineVolume,
            setting: ProjectSetting,
            characters: readonly CharacterCard[],
            options: VolumeChaptersGenerateOptions,
        ): Promise<VolumeChapterDraft[] | null> => {
            if (generatingRef.current) {
                return null
            }
            generatingRef.current = true
            setIsGenerating(true)
            try {
                const result = await request<VolumeChaptersGenerateResult>(
                    'pressAi/aiVolumeChapters',
                    buildPayload(volume, setting, characters, options),
                    AI_REQUEST_TIMEOUT_MS,
                )
                if (result.chapters.length === 0) {
                    toast.error('AI 未返回可用的章纲，请先补全卷纲的主要情节后重试')
                    return null
                }
                return result.chapters
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
            await request('pressAi/aiVolumeChapters/abort')
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

/** 请求载荷：卷纲原文 + 结构 + 本卷伏笔 + 设定快照 + 人物名 + 章序范围 */
function buildPayload(
    volume: OutlineVolume,
    setting: ProjectSetting,
    characters: readonly CharacterCard[],
    options: VolumeChaptersGenerateOptions,
): VolumeChaptersGenerateRequest {
    return {
        volumeName: volume.name,
        coreEvent: volume.coreEvent,
        mainPlot: volume.mainPlot.filter((item) => item.trim().length > 0),
        turningPoints: volume.turningPoints.filter((item) => item.trim().length > 0),
        result: volume.result,
        acts: [...options.acts],
        clues: [...options.clues],
        startOrder: options.startOrder,
        chapterCount: options.chapterCount,
        existingCount: options.existingCount,
        setting: toSettingSnapshot(setting),
        characters: characters.map((character) => character.name),
    }
}
