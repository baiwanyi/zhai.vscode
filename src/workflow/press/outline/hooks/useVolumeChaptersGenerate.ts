/**
 * 按卷生成章纲：把卷纲、作品设定与卷内现状拼成请求交给宿主 pressAi/aiVolumeChapters，
 * 取回「阶段 / 标题 / 介绍」草案供预览对话框勾选。
 * 复用约定：请求经 @shared/utils/bridge，前端超时略大于宿主侧 180s，保证宿主先给出超时错误；
 * 设定快照复用 utils 的 toSettingSnapshot，与设定字段生成同一份口径。
 * 关键约束：同一时刻只允许一次生成，连点由 ref 拦住；对话框关闭（卸载）时走 abort 接口尽力收口；
 * 草案不落库，是否写入由调用方决定；失败原因统一经 sonner 提示，不把错误态留给组件渲染。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
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

/** 生成参数：起始章序、期望章数与卷内已有章数由调用方按当前写入方式算出 */
export interface VolumeChaptersGenerateOptions {
    startOrder: number
    chapterCount: number
    existingCount: number
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

/** 请求载荷：卷纲原文 + 设定快照 + 人物名 + 章序范围 */
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
        startOrder: options.startOrder,
        chapterCount: options.chapterCount,
        existingCount: options.existingCount,
        setting: toSettingSnapshot(setting),
        characters: characters.map((character) => character.name),
    }
}
