/**
 * 人物外貌生成：把人物卡与作品氛围拼成快照交给宿主 pressAi/aiAppearance，取回单段白描文本。
 * 复用约定：请求经 webview 公共 bridge；前端超时略大于宿主侧 60s，保证宿主先给出超时错误；
 * 角色分类与性别使用 CHARACTER_ROLE_META / CHARACTER_GENDER_META 的中文标签，与人物卡展示口径一致。
 * 关键约束：生成中不接受重复提交；取消走 pressAi/aiAppearance/abort，属尽力而为；
 * 结果不直接落库，由调用方写入草稿并由用户点保存，未保存的生成结果只存在于弹窗内；
 * 失败原因统一经 sonner 提示，不回传错误状态给组件渲染。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { CharacterAppearanceRequest, CharacterAppearanceResult } from '@shared/types/press'
import type { CharacterCard } from '../types'
import { request } from '../../../bridge'
import { toastError } from '../../../utils'
import { CHARACTER_GENDER_META, CHARACTER_ROLE_META } from '../constants'

/** AI 通道前端超时：略大于宿主 60s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 70_000

/** 作品层氛围：把外貌约束到同一时代、题材与基调 */
export interface AppearanceContext {
    era: string
    genres: string[]
    tone: string
}

export interface CharacterAppearanceState {
    isGenerating: boolean
    /** 生成成功返回文本，失败返回 null（失败原因已由 sonner 提示） */
    generate: (character: CharacterCard, context: AppearanceContext) => Promise<string | null>
    abort: () => Promise<void>
}

export function useCharacterAppearance(): CharacterAppearanceState {
    const [isGenerating, setIsGenerating] = useState(false)

    const generate = useCallback(
        async (character: CharacterCard, context: AppearanceContext): Promise<string | null> => {
            setIsGenerating(true)
            try {
                const result = await request<CharacterAppearanceResult>(
                    'pressAi/aiAppearance',
                    buildPayload(character, context),
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
                setIsGenerating(false)
            }
        },
        [],
    )

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiAppearance/abort')
        } catch {
            // 取消属于尽力而为：宿主无进行中请求或已结束时忽略错误
        }
    }, [])

    // 组件卸载（关闭弹窗）时取消在途请求，避免结果无人接收却仍消耗配额
    useEffect(() => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { isGenerating, generate, abort }
}

/** 请求载荷：只上传已填字段，空值交给宿主兜底；性别必填，直接取中文标签 */
function buildPayload(character: CharacterCard, context: AppearanceContext): CharacterAppearanceRequest {
    return {
        name: character.name,
        role: CHARACTER_ROLE_META[character.role].label,
        gender: CHARACTER_GENDER_META[character.gender].label,
        age: character.age,
        identity: character.identity,
        traits: [...character.traits],
        desire: character.desire,
        weakness: character.weakness,
        ability: character.ability,
        era: context.era,
        genres: [...context.genres],
        tone: context.tone,
    }
}
