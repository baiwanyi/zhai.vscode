/**
 * 设定字段生成：把目标字段与整份已填设定拼成快照交给宿主 pressAi/aiSettingField，取回可直接写入字段的正文。
 * 复用约定：请求经 @shared/utils/bridge，前端超时略大于宿主侧 45s，保证宿主先给出超时错误；
 * 字段键与宿主白名单同源（shared/types/press 的 SETTING_FIELD_KEYS），提示词与清洗都在宿主侧完成。
 * 关键约束：同一时刻只允许一项生成，按字段记录忙碌态，页面据此只让对应按钮转圈；
 * 页面不提供手动取消，只在卸载时走 pressAi/aiSettingField/abort 尽力收口；结果不落库，
 * 由调用方写入草稿；失败原因统一经 sonner 提示，不回传错误状态给组件渲染。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SettingFieldGenerateRequest, SettingFieldGenerateResult, SettingFieldKey } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { ProjectSetting } from '../types'
import { toSettingSnapshot } from '../utils'

/** AI 通道前端超时：略大于宿主 45s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 55_000

export interface SettingFieldGenerateState {
    /** 正在生成的字段：null 表示空闲 */
    generatingField: SettingFieldKey | null
    /** 生成成功返回正文，失败返回 null（失败原因已由 sonner 提示） */
    generate: (setting: ProjectSetting, field: SettingFieldKey) => Promise<string | null>
    abort: () => Promise<void>
}

export function useSettingFieldGenerate(): SettingFieldGenerateState {
    const [generatingField, setGeneratingField] = useState<SettingFieldKey | null>(null)
    /** 同步标记：setState 生效前的连点会被这里拦住，保证同一时刻只有一项在生成 */
    const generatingRef = useRef(false)

    const generate = useCallback(async (setting: ProjectSetting, field: SettingFieldKey): Promise<string | null> => {
        if (generatingRef.current) {
            return null
        }
        generatingRef.current = true
        setGeneratingField(field)
        try {
            const result = await request<SettingFieldGenerateResult>(
                'pressAi/aiSettingField',
                buildPayload(setting, field),
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
            generatingRef.current = false
            setGeneratingField(null)
        }
    }, [])

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiSettingField/abort')
        } catch {
            // 取消属于尽力而为：宿主无进行中请求或已结束时忽略错误
        }
    }, [])

    // 组件卸载（离开设定页）时取消在途请求，避免结果无人接收却仍消耗配额
    useEffect(() => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { generatingField, generate, abort }
}

/** 请求载荷：目标字段 + 整份设定的只读快照，空字段交给宿主决定是否作为约束 */
function buildPayload(setting: ProjectSetting, field: SettingFieldKey): SettingFieldGenerateRequest {
    return { field, ...toSettingSnapshot(setting) }
}
