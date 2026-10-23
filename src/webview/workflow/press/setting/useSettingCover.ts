/**
 * 作品封面：向宿主提交作品设定快照生成竖版封面，并提供回读、设为封面与删除能力。
 * 复用约定：请求经 webview 公共 bridge；出图常需 1~3 分钟，前端只做 15 分钟兜底；
 * 结果里的 url 已由宿主用 asWebviewUri 转换，前端直接放进 img。
 * 关键约束：封面落在当前作品的 Cover 目录下，所有请求都带作品目录，切换作品不会串图；
 * 生成中不接受重复提交；磁盘是唯一事实来源，切换分组或重开面板都按目录回读；
 * 删除当前封面时以宿主回传的 selectedId 为准，不在前端自行推断回退目标；
 * 失败原因统一经 sonner 提示，不回传错误状态给组件渲染。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
    CoverDeleteRequest,
    CoverDeleteResult,
    CoverGenerateRequest,
    CoverGenerateResult,
    CoverListResult,
    CoverSaveRequest,
    CoverSelectRequest,
    CoverSelectResult,
    PressCover,
} from '@shared/types/press'
import { request } from '../../../bridge'
import { toastError } from '../../../utils'

/** 前端只做兜底：出图内置 10 分钟上限，这里放宽到 15 分钟，避免前端先于宿主判超时 */
const AI_REQUEST_TIMEOUT_MS = 900_000

/** 生成入参：作品目录由 hook 补上，调用方只给出设定快照 */
export type SettingCoverDraft = Omit<CoverGenerateRequest, 'dirPath'>

export interface SettingCoverState {
    /** 已落盘的封面，最新在前 */
    covers: PressCover[]
    /** 当前选中的封面 id：未设置时为 null */
    selectedId: string | null
    /** 首次回读是否仍在进行：用于区分「还没有封面」与「正在读取」 */
    isLoading: boolean
    isGenerating: boolean
    /** 生成成功返回已落盘的封面，失败返回 null（原因已由 sonner 提示）；新图自动成为封面 */
    generate: (draft: SettingCoverDraft) => Promise<PressCover | null>
    /** 保存前端合成好的封面（书名排版），成功返回落盘结果并成为封面 */
    save: (dataUrl: string) => Promise<PressCover | null>
    /** 把指定封面设为作品封面，返回是否成功 */
    select: (path: string) => Promise<boolean>
    /** 删除磁盘上的封面，返回是否真的删掉（当前封面被删时自动回退） */
    remove: (path: string) => Promise<boolean>
}

/** 入参为当前作品目录（press/{作品名}）：封面读写都限定在该作品下 */
export function useSettingCover(dirPath: string): SettingCoverState {
    const [covers, setCovers] = useState<PressCover[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)

    // 磁盘是唯一事实来源：作品切换后重新按目录回读，关闭面板期间完成的生成同样可见
    useEffect(() => {
        let cancelled = false
        setIsLoading(true)
        const load = async (): Promise<void> => {
            try {
                const result = await request<CoverListResult>('pressAi/listCover', { dirPath })
                if (!cancelled) {
                    setCovers(result.covers)
                    setSelectedId(result.selectedId)
                }
            } catch (cause) {
                if (!cancelled) {
                    toastError(cause)
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }
        void load()
        return (): void => {
            cancelled = true
        }
    }, [dirPath])

    const generate = useCallback(
        async (draft: SettingCoverDraft): Promise<PressCover | null> => {
            setIsGenerating(true)
            try {
                const result = await request<CoverGenerateResult>(
                    'pressAi/generateCover',
                    { ...draft, dirPath },
                    AI_REQUEST_TIMEOUT_MS,
                )
                // 新图直接置顶并成为封面：与宿主侧「生成即选中」保持一致
                setCovers((previous) => [result.cover, ...previous])
                setSelectedId(result.cover.id)
                return result.cover
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                setIsGenerating(false)
            }
        },
        [dirPath],
    )

    const save = useCallback(
        async (dataUrl: string): Promise<PressCover | null> => {
            try {
                const payload: CoverSaveRequest = { dirPath, dataUrl }
                const result = await request<CoverGenerateResult>('pressAi/saveCover', payload)
                setCovers((previous) => [result.cover, ...previous])
                setSelectedId(result.cover.id)
                return result.cover
            } catch (cause) {
                toastError(cause)
                return null
            }
        },
        [dirPath],
    )

    const select = useCallback(
        async (path: string): Promise<boolean> => {
            try {
                const payload: CoverSelectRequest = { dirPath, path }
                const result = await request<CoverSelectResult>('pressAi/selectCover', payload)
                setSelectedId(result.selectedId)
                return true
            } catch (cause) {
                toastError(cause)
                return false
            }
        },
        [dirPath],
    )

    const remove = useCallback(
        async (path: string): Promise<boolean> => {
            try {
                // 宿主需要作品目录做归属校验：只有该作品 Cover 下的路径才允许删除
                const payload: CoverDeleteRequest = { dirPath, path }
                const result = await request<CoverDeleteResult>('pressAi/deleteCover', payload)
                if (!result.removed) {
                    return false
                }
                setCovers((previous) => previous.filter((item) => item.path !== path))
                setSelectedId(result.selectedId)
                return true
            } catch (cause) {
                toastError(cause)
                return false
            }
        },
        [dirPath],
    )

    return { covers, selectedId, isLoading, isGenerating, generate, save, select, remove }
}
