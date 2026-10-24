/**
 * 作品详情数据：拉取 press/detail（摘要 + 卷分组章节），并提供新增卷、新增章节、卷重命名/删除、
 * 章节删除/移动、整部作品删除、打开章节与打开作品设定的动作。
 * 复用 ../../bridge 的请求与状态订阅、press/utils 的状态与提示口径；索引变更由 index 通道驱动重拉。
 * 关键约束：新建、卷操作与章节操作共用独立提交态，任一进行中即阻止重复提交；成功后重拉，不等 watcher 防抖；
 * 失败一律提示且不污染已有详情；本地数据只认宿主回包，不在前端拼装章节条目；卷与章节的破坏性操作
 * 返回成功与否供弹窗决定是否关闭，移动还回传落点供页面展开目标卷。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    CreatePressChapterRequest,
    CreatedPressChapter,
    CreatedPressVolume,
    DeletePressProjectResult,
    MovedPressChapter,
    PressProjectDetail,
    RenamedPressVolume,
} from '@shared/types/press'
import type { PressStatus } from '../utils'
import { onState, request } from '../../../bridge'
import { toErrorText, toastError } from '../../../utils'

export interface PressProjectDetailState {
    detail: PressProjectDetail | null
    status: PressStatus
    error: string | null
    isCreatingChapter: boolean
    isCreatingVolume: boolean
    isUpdatingVolume: boolean
    /** 章节级操作进行中：删除/移动期间禁用章节入口，避免并发改动同一文件 */
    isUpdatingChapter: boolean
    /** 整部作品删除进行中：期间禁用页头删除入口，避免重复提交 */
    isDeletingProject: boolean
    reload: () => Promise<void>
    createChapter: (volumeDir?: string) => Promise<void>
    createVolume: () => Promise<void>
    renameVolume: (volumeDir: string, name: string) => Promise<boolean>
    deleteVolume: (volumeDir: string) => Promise<boolean>
    deleteChapter: (path: string) => Promise<boolean>
    /** 删除整部作品：成功后调用方负责跳转作品列表，本层不重拉已删除的详情 */
    deleteProject: () => Promise<boolean>
    /** 移动到目标卷；成功时回传落点，供页面展开目标卷 */
    moveChapter: (path: string, targetVolumeDir: string) => Promise<MovedPressChapter | null>
    openChapter: (path: string) => Promise<void>
    openReadme: () => Promise<void>
}

export function usePressProjectDetail(dirPath: string): PressProjectDetailState {
    const [detail, setDetail] = useState<PressProjectDetail | null>(null)
    const [status, setStatus] = useState<PressStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isCreatingChapter, setIsCreatingChapter] = useState(false)
    const [isCreatingVolume, setIsCreatingVolume] = useState(false)
    const [isUpdatingVolume, setIsUpdatingVolume] = useState(false)
    const [isUpdatingChapter, setIsUpdatingChapter] = useState(false)
    const [isDeletingProject, setIsDeletingProject] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await request<PressProjectDetail>('press/detail', { dirPath })
            setDetail(next)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setDetail(null)
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [dirPath])

    useEffect(() => {
        void reload()
    }, [reload])

    // 章节文件在外部被增删或改写时，索引广播驱动详情重拉
    useEffect(() => {
        return onState((message) => {
            if (message.channel === 'index') {
                void reload()
            }
        })
    }, [reload])

    const createChapter = useCallback(
        async (volumeDir?: string): Promise<void> => {
            setIsCreatingChapter(true)
            const payload: CreatePressChapterRequest = volumeDir === undefined ? { dirPath } : { dirPath, volumeDir }
            try {
                const created = await request<CreatedPressChapter>('press/createChapter', payload)
                const place = created.volume.length > 0 ? `（${created.volume}）` : ''
                toast.success(`已新增章节：${created.title}${place}`)
                await reload()
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsCreatingChapter(false)
            }
        },
        [dirPath, reload],
    )

    const createVolume = useCallback(async (): Promise<void> => {
        setIsCreatingVolume(true)
        try {
            const created = await request<CreatedPressVolume>('press/createVolume', { dirPath })
            toast.success(`已新建${created.volumeName}，并写入首章`)
            await reload()
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsCreatingVolume(false)
        }
    }, [dirPath, reload])

    const renameVolume = useCallback(
        async (volumeDir: string, name: string): Promise<boolean> => {
            setIsUpdatingVolume(true)
            try {
                // 序号前缀由宿主保留，回包携带重命名后的目录名与展示名，前端不自行拼接
                const renamed = await request<RenamedPressVolume>('press/renameVolume', { dirPath, volumeDir, name })
                toast.success(`已重命名为${renamed.volumeName}`)
                await reload()
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsUpdatingVolume(false)
            }
        },
        [dirPath, reload],
    )

    const deleteVolume = useCallback(
        async (volumeDir: string): Promise<boolean> => {
            setIsUpdatingVolume(true)
            try {
                await request('press/deleteVolume', { dirPath, volumeDir })
                toast.success('已删除该卷')
                await reload()
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsUpdatingVolume(false)
            }
        },
        [dirPath, reload],
    )

    const deleteChapter = useCallback(
        async (path: string): Promise<boolean> => {
            setIsUpdatingChapter(true)
            try {
                await request('press/deleteChapter', { dirPath, path })
                toast.success('已删除该章节')
                await reload()
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsUpdatingChapter(false)
            }
        },
        [dirPath, reload],
    )

    const moveChapter = useCallback(
        async (path: string, targetVolumeDir: string): Promise<MovedPressChapter | null> => {
            setIsUpdatingChapter(true)
            try {
                // 新路径与落点卷由宿主重排后回传，前端不自行拼装文件名
                const moved = await request<MovedPressChapter>('press/moveChapter', { dirPath, path, targetVolumeDir })
                const place = moved.volume.length > 0 ? moved.volume : '未分卷'
                toast.success(`已移动到${place}：${moved.title}`)
                await reload()
                return moved
            } catch (cause) {
                toastError(cause)
                return null
            } finally {
                setIsUpdatingChapter(false)
            }
        },
        [dirPath, reload],
    )

    /** 删除整部作品：成功后不重拉详情（作品已不存在），由页面跳回作品列表 */
    const deleteProject = useCallback(async (): Promise<boolean> => {
        setIsDeletingProject(true)
        try {
            const deleted = await request<DeletePressProjectResult>('press/deleteProject', { dirPath })
            // 回收站不可用时宿主会降级为永久删除，此时不能再承诺「可从回收站恢复」
            toast.success(
                deleted.permanent
                    ? '作品已删除（系统回收站不可用，已永久删除，无法恢复）'
                    : '作品已删除，可在系统回收站恢复',
            )
            return true
        } catch (cause) {
            toastError(cause)
            return false
        } finally {
            setIsDeletingProject(false)
        }
    }, [dirPath])

    const openChapter = useCallback(async (path: string): Promise<void> => {
        try {
            await request('press/openChapter', { path })
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    const openReadme = useCallback(async (): Promise<void> => {
        try {
            await request('press/open', { dirPath })
        } catch (cause) {
            toastError(cause)
        }
    }, [dirPath])

    return {
        detail,
        status,
        error,
        isCreatingChapter,
        isCreatingVolume,
        isUpdatingVolume,
        isUpdatingChapter,
        isDeletingProject,
        reload,
        createChapter,
        createVolume,
        renameVolume,
        deleteVolume,
        deleteChapter,
        deleteProject,
        moveChapter,
        openChapter,
        openReadme,
    }
}
