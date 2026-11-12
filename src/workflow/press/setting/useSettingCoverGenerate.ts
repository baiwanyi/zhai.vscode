/**
 * 作品封面生成：把作品设定拼成封面提示词，走统一出图入口 pressAi/generateImage，成功后立即设为作品封面。
 * 复用约定：比例与画风取作品级出图配置（pressAi/getImageSettings），失败回落默认值且不阻断出图；
 * 出图仍由宿主统一扣配额、写侧车与落盘，封面指针经 media/setCover 写入与生图页共用的封面存储。
 * 关键约束：kind 固定 photo——角色图与条目图不进封面候选，作品出处只由 dirPath 决定；
 * 提示词明确要求画面无文字：模型生成的标题字母不可控，书名只用来确定题材与气质，不出现在画面上；
 * 同一时刻只允许一个请求；设封面失败不回滚已生成的图片，只提示可去图库手动选择。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_IMAGE_SETTINGS } from '@shared/types/imagegen'
import type { ImageGenerateResult, ImageSettings, ImageSettingsResult } from '@shared/types/imagegen'
import type { MediaItem, MediaSetCoverResult } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { ProjectSetting } from '../types'

/** 出图前端超时：与生图页同值，略大于宿主 10 分钟上限，避免前端先于宿主判超时 */
const GENERATE_TIMEOUT_MS = 900_000

/** 梗概参与出图的长度上限：封面看的是气质与主体，整段简介会让画面失去焦点 */
const MAX_LOGLINE_IN_PROMPT = 120

/** 世界观参与出图的长度上限：留一句世界形态即可，细节交给上下文之外的阅读 */
const MAX_WORLDVIEW_IN_PROMPT = 200

/**
 * 拼封面提示词：书名、题材、梗概、世界设定、时代与基调依次成行，空字段跳过。
 * 末行固定为构图与「无文字」约束——封面文字由排版承担，模型写出的标题只会变成乱码。
 */
function composeCoverPrompt(setting: ProjectSetting): string {
    const title = setting.title.trim()
    const lines = [title.length > 0 ? `小说封面插画：《${title}》` : '小说封面插画']
    const genres = setting.genres.join('、')
    if (genres.length > 0) {
        lines.push(`题材：${genres}`)
    }
    const logline = setting.logline.trim()
    if (logline.length > 0) {
        lines.push(`故事核心：${logline.slice(0, MAX_LOGLINE_IN_PROMPT)}`)
    }
    const worldview = setting.worldview.trim()
    if (worldview.length > 0) {
        lines.push(`世界设定：${worldview.slice(0, MAX_WORLDVIEW_IN_PROMPT)}`)
    }
    const era = setting.era.trim()
    if (era.length > 0) {
        lines.push(`时代：${era}`)
    }
    const tone = setting.tone.trim()
    if (tone.length > 0) {
        lines.push(`基调：${tone}`)
    }
    lines.push('竖版书籍封面构图：主体明确、氛围统一、留白适度；画面中不出现任何文字、标题、字母或水印')
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

export interface SettingCoverGenerateState {
    /** 是否有在途请求：生成按钮据此显示加载态并禁用 */
    isGenerating: boolean
    /** 生成一张封面并设为作品封面：成功返回新图，失败返回 null（原因已由 sonner 提示） */
    generate: (setting: ProjectSetting) => Promise<MediaItem | null>
}

/** 入参为当前作品目录：出图落点与封面指针都限定在该作品下 */
export function useSettingCoverGenerate(dirPath: string): SettingCoverGenerateState {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 进行中标记：state 更新是异步的，连点两次都会读到旧值，必须用 ref 挡住 */
    const activeRef = useRef(false)

    const generate = useCallback(
        async (setting: ProjectSetting): Promise<MediaItem | null> => {
            if (activeRef.current) {
                return null
            }
            activeRef.current = true
            setIsGenerating(true)
            try {
                const settings = await readImageSettings(dirPath)
                const result = await request<ImageGenerateResult>(
                    'pressAi/generateImage',
                    {
                        dirPath,
                        prompt: composeCoverPrompt(setting),
                        // 普通图不带角色与条目归属：封面候选只取 photo / unknown，需要这张图进候选
                        kind: 'photo',
                        ratio: settings.defaultRatio,
                        style: settings.portraitStyle,
                    },
                    GENERATE_TIMEOUT_MS,
                )
                try {
                    await request<MediaSetCoverResult>('media/setCover', {
                        id: result.image.id,
                        pressPath: dirPath,
                    })
                } catch (cause) {
                    // 图片已落盘：设封面失败不回滚，交给图库手动选择
                    toastError(cause)
                    toast.info('封面已生成，可在图库中手动设为首选')
                    return result.image
                }
                toast.success('作品封面已生成并设为封面')
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
