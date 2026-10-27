/**
 * 词库钩子：列举词条与分组，并提供新建、改写、删除与打开目录。
 * 复用约定：协议走 pressAi/listPromptTags、savePromptTag、updatePromptTag、deletePromptTag、openPromptTagDir，
 * 类型取 @shared/types/imagegen；请求经 @shared/utils/bridge，失败统一 toastError。
 * 关键约束：不自动加载，由面板打开时调 reload；只有首次加载才进入 isLoading（面板显示加载态），
 * 之后每次打开只做静默刷新——旧数据立即呈现，回包后再整体覆盖，用户不会再看到「重新加载」；
 * 静默刷新失败时保留已有词库，不退回空态也不弹错，避免一次读盘抖动清掉用户正在浏览的面板；
 * 同一时刻只允许一条列举请求在途，连续开关面板复用同一次结果；
 * 写操作一律以宿主回传的整表为准，不在本地拼接，避免与 md 的实际内容分叉；
 * 改写成功后返回新条目，供调用方同步已挂芯片的标识。
 */
import { useCallback, useRef, useState } from 'react'
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
    /** 是否成功列举过一次：决定这次打开是「加载」还是「静默刷新」 */
    const hasLoadedRef = useRef(false)
    /** 在途的列举请求：并发的 reload 复用同一个 promise，不重复扫盘 */
    const inFlightRef = useRef<Promise<void> | null>(null)

    const reload = useCallback((): Promise<void> => {
        const running = inFlightRef.current
        if (running !== null) {
            return running
        }
        const isInitial = !hasLoadedRef.current
        if (isInitial) {
            setIsLoading(true)
        }
        const task = request<PromptTagListResult>('pressAi/listPromptTags')
            .then((next) => {
                setData(next)
                hasLoadedRef.current = true
            })
            .catch((cause: unknown) => {
                // 已有词库时静默失败：保留旧数据，不为一次读盘抖动把面板退回空态
                if (isInitial) {
                    setData(EMPTY)
                    toastError(cause)
                }
            })
            .finally(() => {
                if (isInitial) {
                    setIsLoading(false)
                }
                inFlightRef.current = null
            })
        inFlightRef.current = task
        return task
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
