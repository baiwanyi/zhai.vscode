/**
 * 卷纲单字段生成：把这一卷的现状（含弹窗里未落盘的草稿）与作品设定交给宿主 pressAi/aiVolumeField，
 * 只补请求的那一项（核心事件 / 卷末结果）。
 * 复用约定：请求经 @shared/utils/bridge，前端超时略大于宿主侧 45s，保证宿主先给出超时错误；
 * 设定快照复用 utils 的 toSettingSnapshot，与设定字段、卷纲生成同一份口径。
 * 关键约束：同一时刻只允许一项在生成，连点由 ref 拦住；对话框关闭（卸载）时走 abort 接口尽力收口；
 * 生成结果不直接落库，由调用方决定写进哪个输入框；失败原因统一经 sonner 提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VolumeFieldGenerateRequest, VolumeFieldGenerateResult, VolumeFieldKey } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import { toSettingSnapshot } from '../../utils'

/** AI 通道前端超时：略大于宿主 45s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 60_000

/** 生成参数：字段 + 这一卷的当前草稿 + 作品设定与人物名单 */
export interface VolumeFieldGenerateOptions {
    field: VolumeFieldKey
    volume: OutlineVolume
    /** 弹窗里的本地草稿：尚未保存的编辑也要进上下文，避免 AI 基于旧内容续写 */
    draft: {
        coreEvent: string
        mainPlot: readonly string[]
        turningPoints: readonly string[]
        result: string
    }
    setting: ProjectSetting
    characters: readonly CharacterCard[]
}

export interface VolumeFieldGenerateState {
    /** 正在生成的字段：null 表示空闲，任一字段生成时调用方应禁用两个按钮 */
    generatingField: VolumeFieldKey | null
    /** 生成成功返回正文，失败或取消返回 null（原因已提示） */
    generate: (options: VolumeFieldGenerateOptions) => Promise<string | null>
    abort: () => Promise<void>
}

export function useVolumeFieldGenerate(): VolumeFieldGenerateState {
    const [generatingField, setGeneratingField] = useState<VolumeFieldKey | null>(null)
    /** 同步标记：setState 生效前的连点会被这里拦住 */
    const busyRef = useRef(false)

    const generate = useCallback(async (options: VolumeFieldGenerateOptions): Promise<string | null> => {
        if (busyRef.current) {
            return null
        }
        busyRef.current = true
        setGeneratingField(options.field)
        try {
            const result = await request<VolumeFieldGenerateResult>(
                'pressAi/aiVolumeField',
                buildPayload(options),
                AI_REQUEST_TIMEOUT_MS,
            )
            return result.content
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            busyRef.current = false
            setGeneratingField(null)
        }
    }, [])

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiVolumeField/abort')
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

    return { generatingField, generate, abort }
}

/** 请求载荷：字段 + 卷现状 + 设定快照 + 人物名 */
function buildPayload(options: VolumeFieldGenerateOptions): VolumeFieldGenerateRequest {
    return {
        field: options.field,
        volumeName: options.volume.name,
        coreEvent: options.draft.coreEvent,
        mainPlot: options.draft.mainPlot.filter((item) => item.trim().length > 0),
        turningPoints: options.draft.turningPoints.filter((item) => item.trim().length > 0),
        result: options.draft.result,
        setting: toSettingSnapshot(options.setting),
        characters: options.characters.map((character) => character.name),
    }
}
