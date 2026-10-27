/**
 * 词库钩子：列举词条与分组，并提供新建、改写、删除与打开目录。
 * 复用约定：协议走 pressAi/listPromptTags、savePromptTag、updatePromptTag、deletePromptTag、openPromptTagDir，
 * 类型取 @shared/types/imagegen；请求经 @shared/utils/bridge，失败统一 toastError。
 * 关键约束：不自动加载，由面板打开时调 reload；写操作一律以宿主回传的整表为准，
 * 不在本地拼接，避免与 md 的实际内容分叉；改写成功后返回新条目，供调用方同步已挂芯片的标识。
 */
import { useCallback, useState } from 'react'
import type {
    PromptTag,
    PromptTagListResult,
    PromptTagObject,
    PromptTagSaveRequest,
    PromptTagUpdateRequest,
} from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 词库读写兜底超时：单个 md 的读写，正常远低于默认值 */
const TAG_TIMEOUT_MS = 30_000

/** 词条表单状态：original 为 null 表示新建，否则按该条回填 */
export interface TagFormState {
    original: PromptTag | null
}

interface UsePromptLibraryResult {
    objects: readonly PromptTagObject[]
    tags: readonly PromptTag[]
    /** 词库目录绝对路径：空态据此提示用户把 md 放到哪里 */
    dirPath: string
    /** 预览图目录绝对路径：无图时提示图片该放到哪里 */
    imageDirPath: string
    isLoading: boolean
    /** 写操作进行中：新建、改写与删除共用，弹窗据此禁用提交 */
    isSaving: boolean
    reload: () => Promise<void>
    /** 新建词条：成功返回新条目，失败返回 null（错误已提示） */
    save: (input: PromptTagSaveRequest) => Promise<PromptTag | null>
    /** 改写词条：成功返回新条目，失败返回 null（错误已提示） */
    update: (input: PromptTagUpdateRequest) => Promise<PromptTag | null>
    /** 删除词条：成功后以最新列表覆盖，失败返回 false（错误已提示） */
    remove: (id: string) => Promise<boolean>
    /** 打开词库目录并同步最新列表 */
    openDir: () => Promise<void>
}

/** 空列表：未加载与加载失败时共用，面板照常渲染空态 */
const EMPTY: PromptTagListResult = { objects: [], tags: [], dirPath: '', imageDirPath: '' }

export function usePromptLibrary(): UsePromptLibraryResult {
    const [data, setData] = useState<PromptTagListResult>(EMPTY)
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        try {
            setData(await request<PromptTagListResult>('pressAi/listPromptTags'))
        } catch (cause) {
            setData(EMPTY)
            toastError(cause)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const save = useCallback(async (input: PromptTagSaveRequest): Promise<PromptTag | null> => {
        setIsSaving(true)
        try {
            const tag = await request<PromptTag>('pressAi/savePromptTag', input, TAG_TIMEOUT_MS)
            setData(await request<PromptTagListResult>('pressAi/listPromptTags'))
            return tag
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            setIsSaving(false)
        }
    }, [])

    const update = useCallback(async (input: PromptTagUpdateRequest): Promise<PromptTag | null> => {
        setIsSaving(true)
        try {
            const tag = await request<PromptTag>('pressAi/updatePromptTag', input, TAG_TIMEOUT_MS)
            setData(await request<PromptTagListResult>('pressAi/listPromptTags'))
            return tag
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            setIsSaving(false)
        }
    }, [])

    const remove = useCallback(async (id: string): Promise<boolean> => {
        setIsSaving(true)
        try {
            setData(await request<PromptTagListResult>('pressAi/deletePromptTag', { id }, TAG_TIMEOUT_MS))
            return true
        } catch (cause) {
            toastError(cause)
            return false
        } finally {
            setIsSaving(false)
        }
    }, [])

    const openDir = useCallback(async (): Promise<void> => {
        try {
            setData(await request<PromptTagListResult>('pressAi/openPromptTagDir'))
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    return {
        objects: data.objects,
        tags: data.tags,
        dirPath: data.dirPath,
        imageDirPath: data.imageDirPath,
        isLoading,
        isSaving,
        reload,
        save,
        update,
        remove,
        openDir,
    }
}
