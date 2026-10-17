/**
 * 作品详情数据：拉取 press/detail（摘要 + 卷分组章节），并提供新增章节、打开章节与打开作品设定的动作。
 * 复用 ../../bridge 的请求与状态订阅、press/utils 的状态与提示口径；索引变更由 index 通道驱动重拉。
 * 关键约束：新增章节进行中置 isCreatingChapter 阻止重复提交；成功后重拉，不等 watcher 防抖；
 * 失败一律提示且不污染已有详情；本地数据只认宿主回包，不在前端拼装章节条目。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { CreatedPressChapter, PressProjectDetail } from '@/shared/types/press'
import type { PressStatus } from '../utils'
import { onState, request } from '../../../bridge'
import { toastError } from '../utils'

export interface PressProjectDetailState {
    detail: PressProjectDetail | null
    status: PressStatus
    error: string | null
    isCreatingChapter: boolean
    reload: () => Promise<void>
    createChapter: () => Promise<void>
    openChapter: (path: string) => Promise<void>
    openReadme: () => Promise<void>
}

export function usePressProjectDetail(dirPath: string): PressProjectDetailState {
    const [detail, setDetail] = useState<PressProjectDetail | null>(null)
    const [status, setStatus] = useState<PressStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isCreatingChapter, setIsCreatingChapter] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await request<PressProjectDetail>('press/detail', { dirPath })
            setDetail(next)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setDetail(null)
            setStatus('error')
            setError(cause instanceof Error ? cause.message : String(cause))
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

    const createChapter = useCallback(async (): Promise<void> => {
        setIsCreatingChapter(true)
        try {
            const created = await request<CreatedPressChapter>('press/createChapter', { dirPath })
            const place = created.volume.length > 0 ? `（${created.volume}）` : ''
            toast.success(`已新增章节：${created.title}${place}`)
            await reload()
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsCreatingChapter(false)
        }
    }, [dirPath, reload])

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

    return { detail, status, error, isCreatingChapter, reload, createChapter, openChapter, openReadme }
}
