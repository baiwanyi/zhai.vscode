/**
 * 条目设定图生成：用条目名称与描述拼装提示词，走统一出图入口（pressAi/generateImage）。
 * 复用约定：比例与画风取作品级生图配置（pressAi/getImageSettings），读取失败回落默认值且不阻断出图；
 * 出图仍由宿主统一扣配额、写侧车与落盘，前端只负责拼提示词与回执。
 * 关键约束：kind 固定 lore 并携带 loreKind / loreId——文件名前缀与归属都靠这两个字段，
 * 缺任一项宿主会直接拒绝；同一时刻只允许一个请求，避免连点重复出图；
 * 提示词只截取描述开头，设定图看的是主体与场景，整段背景长文会让画面失去焦点。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_IMAGE_SETTINGS } from '@shared/types/imagegen'
import type { ImageGenerateResult, ImageSettings, ImageSettingsResult, PressImageItem } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { LoreEntry } from '../../types'

/** 描述参与出图的长度上限：只取开头，避免长背景压过主体 */
const MAX_DESCRIPTION_IN_PROMPT = 400

/** 条目类别说明：提示词里用中文点明主体类型，模型据此调整构图 */
const LORE_KIND_PROMPT: Readonly<Record<LoreEntry['kind'], string>> = {
    faction: '势力',
    place: '地点',
    item: '物品',
}

/** 拼出图提示词：类别 + 名称打头，描述作为细节补充 */
function composeLorePrompt(entry: LoreEntry): string {
    const description = entry.description.trim().slice(0, MAX_DESCRIPTION_IN_PROMPT)
    const head = `${LORE_KIND_PROMPT[entry.kind]}「${entry.name}」的设定图`
    return description.length > 0 ? `${head}，${description}` : head
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

interface UseLoreGenerateResult {
    /** 是否有在途请求：出图按钮据此显示加载态并禁用 */
    isGenerating: boolean
    /** 为条目生成一张设定图：成功返回新图，失败返回 null 并已提示 */
    generate: (entry: LoreEntry) => Promise<PressImageItem | null>
}

export function useLoreGenerate(dirPath: string): UseLoreGenerateResult {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 进行中标记：state 更新是异步的，连点两次都会读到旧值，必须用 ref 挡住 */
    const activeRef = useRef(false)

    const generate = useCallback(
        async (entry: LoreEntry): Promise<PressImageItem | null> => {
            if (activeRef.current) {
                return null
            }
            activeRef.current = true
            setIsGenerating(true)
            try {
                const settings = await readImageSettings(dirPath)
                const result = await request<ImageGenerateResult>('pressAi/generateImage', {
                    dirPath,
                    prompt: composeLorePrompt(entry),
                    kind: 'lore',
                    characterId: null,
                    loreKind: entry.kind,
                    loreId: entry.id,
                    ratio: settings.defaultRatio,
                    style: settings.portraitStyle,
                })
                toast.success('设定图已生成')
                return result.image
            } catch (cause) {
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
