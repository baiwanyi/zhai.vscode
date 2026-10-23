/**
 * 角色设定图：向宿主提交人物卡与作品氛围快照，取回落盘后的图片信息，并提供列举与删除能力。
 * 复用约定：请求经 webview 公共 bridge；出图常需 1~3 分钟，超时由宿主按 zhai.image.timeoutSeconds 裁决，
 * 前端只做 15 分钟兜底并在失败时主动取消宿主请求；结果里的 url 已由宿主用 asWebviewUri 转换，前端直接放进 img。
 * 关键约束：图片落在当前作品的 _portraits 目录下，因此所有请求都带作品目录，切换作品后不会串图；
 * 生成中不接受重复提交；磁盘是图片的唯一事实来源，关闭弹窗不取消在途请求，
 * 结果会在下次打开角色卡时由 list 从角色目录读回，因此这里不做卸载取消；
 * 复制由宿主写系统剪贴板（webview 内写图片受 CSP 与权限限制），本层只接收结果；
 * 失败原因统一经 sonner 提示，不回传错误状态给组件渲染。
 */
import { useCallback, useState } from 'react'
import type {
    CharacterPortrait,
    PortraitCopyResult,
    PortraitGenerateRequest,
    PortraitGenerateResult,
    PortraitInsertResult,
    PortraitListResult,
} from '@shared/types/press'
import type { CharacterCard } from '../types'
import type { AppearanceContext } from './useCharacterAppearance'
import { request } from '../../../bridge'
import { toastError } from '../../../utils'
import { CHARACTER_GENDER_META, CHARACTER_ROLE_META } from '../constants'

/** 前端只做兜底：出图内置 10 分钟上限，这里放宽到 15 分钟，避免前端先于宿主判超时 */
const AI_REQUEST_TIMEOUT_MS = 900_000

export interface CharacterPortraitState {
    isGenerating: boolean
    /** 生成成功返回已落盘的图片信息，失败返回 null（失败原因已由 sonner 提示） */
    generate: (character: CharacterCard, context: AppearanceContext) => Promise<CharacterPortrait | null>
    /** 扫描角色目录读回已落盘的图片，按生成时间升序；目录不存在返回空数组 */
    list: (characterId: string) => Promise<CharacterPortrait[]>
    /** 由宿主把图片写入系统剪贴板；平台不支持时返回 reason=unsupported */
    copy: (path: string) => Promise<PortraitCopyResult | null>
    /** 把图片插入当前编辑器光标处；无活动编辑器时返回 reason=no-editor */
    insert: (path: string) => Promise<PortraitInsertResult | null>
    /** 删除磁盘上的图片，返回是否真的删掉 */
    remove: (path: string) => Promise<boolean>
    abort: () => Promise<void>
}

/** 入参为当前作品目录（press/{作品名}）：角色卡读写都限定在该作品下 */
export function useCharacterPortrait(dirPath: string): CharacterPortraitState {
    const [isGenerating, setIsGenerating] = useState(false)

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
            try {
                const result = await request<PortraitGenerateResult>(
                    'pressAi/generatePortrait',
                    buildPayload(character, context, dirPath),
                    AI_REQUEST_TIMEOUT_MS,
                )
                return result.portrait
            } catch (cause) {
                // 前端兜底超时后宿主可能仍在生成，主动取消以释放并发锁
                void abort()
                toastError(cause)
                return null
            } finally {
                setIsGenerating(false)
            }
        },
        [abort, dirPath],
    )

    const list = useCallback(
        async (characterId: string): Promise<CharacterPortrait[]> => {
            try {
                const result = await request<PortraitListResult>('pressAi/listPortraits', { dirPath, characterId })
                return result.portraits
            } catch (cause) {
                toastError(cause)
                return []
            }
        },
        [dirPath],
    )

    const copy = useCallback(async (path: string): Promise<PortraitCopyResult | null> => {
        try {
            return await request<PortraitCopyResult>('pressAi/copyPortrait', { path })
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [])

    const insert = useCallback(async (path: string): Promise<PortraitInsertResult | null> => {
        try {
            return await request<PortraitInsertResult>('pressAi/insertPortrait', { path })
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [])

    const remove = useCallback(async (path: string): Promise<boolean> => {
        try {
            const result = await request<{ removed: boolean }>('pressAi/deletePortrait', { path })
            return result.removed
        } catch (cause) {
            toastError(cause)
            return false
        }
    }, [])

    return { isGenerating, generate, list, copy, insert, remove, abort }
}

/** 请求载荷：作品目录决定落盘位置，其余只上传已填字段；性别必填，直接取中文标签 */
function buildPayload(character: CharacterCard, context: AppearanceContext, dirPath: string): PortraitGenerateRequest {
    return {
        dirPath,
        characterId: character.id,
        name: character.name,
        role: CHARACTER_ROLE_META[character.role].label,
        gender: CHARACTER_GENDER_META[character.gender].label,
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
