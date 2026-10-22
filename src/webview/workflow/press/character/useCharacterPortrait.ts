/**
 * 角色设定图：向宿主提交人物卡与作品氛围快照，取回落盘后的图片信息，并提供删除能力。
 * 复用约定：请求经 webview 公共 bridge；出图常需 1~3 分钟，超时由宿主按 zhai.image.timeoutSeconds 裁决，
 * 前端只做 15 分钟兜底并在失败时主动取消宿主请求；结果里的 url 已由宿主用 asWebviewUri 转换，前端直接放进 img。
 * 关键约束：生成中不接受重复提交；取消走 pressAi/aiPortrait/abort，属尽力而为；
 * 图片文件立即落盘，但人物卡仍在内存，未点保存的「采用」只存在于编辑弹窗草稿中。
 */
import { useCallback, useEffect, useState } from 'react'
import type { CharacterPortrait, PortraitGenerateRequest, PortraitGenerateResult } from '@shared/types/press'
import type { CharacterCard } from '../types'
import type { AppearanceContext } from './useCharacterAppearance'
import { request } from '../../../bridge'
import { CHARACTER_ROLE_META } from '../constants'

/** 前端只做兜底：出图内置 10 分钟上限，这里放宽到 15 分钟，避免前端先于宿主判超时 */
const AI_REQUEST_TIMEOUT_MS = 900_000

export interface CharacterPortraitState {
    isGenerating: boolean
    error: string | null
    /** 生成成功返回已落盘的图片信息，失败返回 null 并在 error 中留下可读原因 */
    generate: (character: CharacterCard, context: AppearanceContext) => Promise<CharacterPortrait | null>
    /** 删除磁盘上的图片，返回是否真的删掉 */
    remove: (path: string) => Promise<boolean>
    abort: () => Promise<void>
}

export function useCharacterPortrait(): CharacterPortraitState {
    const [isGenerating, setIsGenerating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiPortrait/abort')
        } catch {
            // 取消属于尽力而为：宿主无进行中请求或已结束时忽略错误
        }
    }, [])

    const generate = useCallback(
        async (character: CharacterCard, context: AppearanceContext): Promise<CharacterPortrait | null> => {
            setIsGenerating(true)
            setError(null)
            try {
                const result = await request<PortraitGenerateResult>(
                    'pressAi/generatePortrait',
                    buildPayload(character, context),
                    AI_REQUEST_TIMEOUT_MS,
                )
                return result.portrait
            } catch (cause) {
                // 前端兜底超时后宿主可能仍在生成，主动取消以释放并发锁
                void abort()
                setError(cause instanceof Error ? cause.message : String(cause))
                return null
            } finally {
                setIsGenerating(false)
            }
        },
        [abort],
    )

    const remove = useCallback(async (path: string): Promise<boolean> => {
        try {
            const result = await request<{ removed: boolean }>('pressAi/deletePortrait', { path })
            return result.removed
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
            return false
        }
    }, [])

    // 卸载（关闭弹窗）时取消在途请求，避免结果无人接收却仍占用配额
    useEffect(() => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { isGenerating, error, generate, remove, abort }
}

/** 请求载荷：只上传已填字段，空值交给宿主兜底 */
function buildPayload(character: CharacterCard, context: AppearanceContext): PortraitGenerateRequest {
    return {
        characterId: character.id,
        name: character.name,
        role: CHARACTER_ROLE_META[character.role].label,
        age: character.age,
        identity: character.identity,
        appearance: character.appearance,
        traits: [...character.traits],
        desire: character.desire,
        weakness: character.weakness,
        ability: character.ability,
        era: context.era,
        genres: [...context.genres],
        tone: context.tone,
        style: character.portraitStyle,
    }
}
