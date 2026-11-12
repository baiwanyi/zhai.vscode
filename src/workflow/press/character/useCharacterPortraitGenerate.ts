/**
 * 角色形象生成：把人物卡属性拼成提示词、作品设定展开为上下文，走统一出图入口 pressAi/generateImage。
 * 复用约定：比例与画风取作品级出图配置（pressAi/getImageSettings），读取失败回落默认值且不阻断出图；
 * 设定段复用 workflow/media/prompt 的 composeSettingContext 纯函数，不引入生图页的状态与 hook；
 * 出图仍由宿主统一扣配额、写侧车与落盘，前端只负责拼提示词与回执。
 * 关键约束：kind 固定 portrait 并携带 8 位角色标识——缺标识宿主直接拒绝，姓名快照供角色删除后仍能显示归属；
 * 同一时刻只允许一个请求，避免连点重复扣图；性别、身高与体型是构图硬约束，外貌标签优先于外貌描写，
 * 作品设定不进正文：长篇世界观混进提示词会压过人物主体。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_IMAGE_SETTINGS } from '@shared/types/imagegen'
import type { ImageGenerateResult, ImageSettings, ImageSettingsResult } from '@shared/types/imagegen'
import type { MediaItem } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { composeSettingContext } from '@webview/workflow/media/prompt/promptSections'
import type { PromptSettingSnapshot } from '@webview/workflow/media/prompt/promptSections'
import type { CharacterCard } from '../types'
import { CHARACTER_BODY_TYPE_META, CHARACTER_GENDER_META } from '../constants'

/** 出图前端超时：与生图页同值，略大于宿主 10 分钟上限，避免前端先于宿主判超时 */
const GENERATE_TIMEOUT_MS = 900_000

/** 外貌描写参与出图的长度上限：标签之外只取开头，整段长文会稀释标签给出的硬约束 */
const MAX_APPEARANCE_IN_PROMPT = 200

/** 性格标签参与出图的条数上限：气质只作点缀，拼多了会把立绘写成剧情插图 */
const MAX_TRAITS_IN_PROMPT = 3

/**
 * 拼角色提示词：主体行是性别、年龄、身高与体型，身份与外貌各自成行，空字段一律跳过。
 * 关键约束：体型取默认档「匀称」时不拼——它不提供区分度，写进去只会稀释其它约束。
 */
function composePortraitPrompt(character: CharacterCard): string {
    const gender = CHARACTER_GENDER_META[character.gender].label
    const bodyType = character.bodyType === 'average' ? '' : CHARACTER_BODY_TYPE_META[character.bodyType].label
    const profile = [gender, character.age.trim(), character.height.trim(), bodyType].filter((part) => part.length > 0)
    const head = profile.length > 0 ? `${profile.join('，')}的${character.name.trim()}` : character.name.trim()
    const lines = [`角色形象：${head}`]
    const identity = character.identity.trim()
    if (identity.length > 0) {
        lines.push(`身份：${identity}`)
    }
    const looks = [
        character.appearanceTags.join('、'),
        character.appearance.trim().slice(0, MAX_APPEARANCE_IN_PROMPT),
    ].filter((part) => part.length > 0)
    if (looks.length > 0) {
        lines.push(`外貌：${looks.join('；')}`)
    }
    const traits = character.traits.slice(0, MAX_TRAITS_IN_PROMPT)
    if (traits.length > 0) {
        lines.push(`气质：${traits.join('、')}`)
    }
    return lines.join('\n')
}

/** 读取作品级出图配置：失败回落默认值，参数问题不应阻断出图 */
async function readImageSettings(dirPath: string): Promise<ImageSettings> {
    try {
        const result = await request<ImageSettingsResult>('pressAi/getImageSettings', { dirPath })
        return result.settings
    } catch {
        return DEFAULT_IMAGE_SETTINGS
    }
}

export interface CharacterPortraitGenerateState {
    /** 是否有在途请求：生成按钮据此显示加载态并禁用 */
    isGenerating: boolean
    /** 生成一张角色形象图：成功返回新图，失败返回 null（原因已由 sonner 提示） */
    generate: (character: CharacterCard, setting: PromptSettingSnapshot) => Promise<MediaItem | null>
}

/** 入参为当前作品目录：出图落点与归属都限定在该作品下 */
export function useCharacterPortraitGenerate(dirPath: string): CharacterPortraitGenerateState {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 进行中标记：state 更新是异步的，连点两次都会读到旧值，必须用 ref 挡住 */
    const activeRef = useRef(false)

    const generate = useCallback(
        async (character: CharacterCard, setting: PromptSettingSnapshot): Promise<MediaItem | null> => {
            if (activeRef.current) {
                return null
            }
            activeRef.current = true
            setIsGenerating(true)
            try {
                const settings = await readImageSettings(dirPath)
                const context = composeSettingContext(setting)
                const result = await request<ImageGenerateResult>(
                    'pressAi/generateImage',
                    {
                        dirPath,
                        prompt: composePortraitPrompt(character),
                        // 作品设定作为独立上下文提交，不混进正文：宿主会把它排在规则段之前
                        contexts: context.length > 0 ? [context] : undefined,
                        kind: 'portrait',
                        characterId: character.id,
                        // 角色名快照随请求带入：宿主写入媒体出处，删除角色后仍能显示原归属
                        characterName: character.name,
                        ratio: settings.defaultRatio,
                        // 画风由人物卡持有：auto 交给全局配置与宿主按题材匹配
                        style: character.portraitStyle === 'auto' ? settings.portraitStyle : character.portraitStyle,
                    },
                    GENERATE_TIMEOUT_MS,
                )
                toast.success('角色形象已生成，保存人物卡后生效')
                return result.image
            } catch (cause) {
                // 超时或失败后宿主可能仍在出图：主动取消释放单任务锁，避免下一次点击被拒
                try {
                    await request('pressAi/generateImage/abort', { dirPath })
                } catch {
                    // 取消属于尽力而为：宿主无在途请求或已结束时忽略错误
                }
                toastError(cause)
                return null
            } finally {
                activeRef.current = false
                setIsGenerating(false)
            }
        },
        [dirPath],
    )

    return { isGenerating, generate }
}
