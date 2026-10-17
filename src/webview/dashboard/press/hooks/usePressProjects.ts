/**
 * 作品列表数据：拉取 press/projects 快照，并提供新建、打开与重建索引三个动作。
 * 复用 ../../bridge 的请求与状态订阅、sonner 的提示；外部增删作品目录时由 index 通道驱动重拉。
 * 关键约束：创建进行中置 isCreating 阻止重复提交；失败一律提示且不污染已有列表；
 * 创建成功后立即重拉，不等 watcher 防抖，使新作品即时出现在列表中。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    CreatePressProjectRequest,
    CreatePressProjectResult,
    OpenPressProjectResult,
    PressCategory,
    PressProjectSummary,
} from '@/shared/types/press'
import { onState, request } from '../../../bridge'

/** 列表加载状态：ready 表示已拿到快照，error 表示最近一次拉取失败 */
export type PressStatus = 'loading' | 'ready' | 'error'

export interface PressProjectsState {
    projects: PressProjectSummary[]
    status: PressStatus
    error: string | null
    isCreating: boolean
    reload: () => Promise<void>
    createProject: (name: string, category: PressCategory) => Promise<boolean>
    openProject: (dirPath: string) => Promise<void>
    rebuildIndex: () => Promise<void>
}

/** 提示文案统一在数据层发出，页面只负责编排 */
function toastError(cause: unknown): void {
    toast.error(cause instanceof Error ? cause.message : String(cause))
}

export function usePressProjects(): PressProjectsState {
    const [projects, setProjects] = useState<PressProjectSummary[]>([])
    const [status, setStatus] = useState<PressStatus>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await request<PressProjectSummary[]>('press/projects')
            setProjects(Array.isArray(next) ? next : [])
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStatus('error')
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    // 索引变更（新建/删除作品文档、重建索引）由宿主经 index 通道广播，收到即重拉
    useEffect(() => {
        return onState((message) => {
            if (message.channel === 'index') {
                void reload()
            }
        })
    }, [reload])

    const createProject = useCallback(
        async (name: string, category: PressCategory): Promise<boolean> => {
            setIsCreating(true)
            const payload: CreatePressProjectRequest = { name, category }
            try {
                const created = await request<CreatePressProjectResult>('press/create', payload)
                toast.success(`已创建作品：${created.title}`)
                await reload()
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsCreating(false)
            }
        },
        [reload],
    )

    const openProject = useCallback(async (dirPath: string): Promise<void> => {
        try {
            await request<OpenPressProjectResult>('press/open', { dirPath })
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    const rebuildIndex = useCallback(async (): Promise<void> => {
        try {
            await request('host/command', 'zhai.rebuildIndex')
            toast.info('已开始重建索引，完成后列表自动刷新')
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    return { projects, status, error, isCreating, reload, createProject, openProject, rebuildIndex }
}
