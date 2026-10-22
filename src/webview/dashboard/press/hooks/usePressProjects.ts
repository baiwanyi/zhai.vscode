/**
 * 作品列表数据：拉取 press/projects 快照，并提供新建作品与重建索引两个动作。
 * 复用 ../../bridge 的请求与状态订阅、press/utils 的状态与提示口径；外部增删作品目录时由 index 通道驱动重拉。
 * 关键约束：创建进行中置 isCreating 阻止重复提交；失败一律提示且不污染已有列表；
 * 创建成功后立即重拉，不等 watcher 防抖，使新作品即时出现在列表中。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    CreatePressProjectRequest,
    CreatePressProjectResult,
    PressAudience,
    PressProjectSummary,
} from '@shared/types/press'
import type { PressStatus } from '../utils'
import { onState, request } from '../../../bridge'
import { toastError } from '../../../utils'

export interface PressProjectsState {
    projects: PressProjectSummary[]
    status: PressStatus
    error: string | null
    isCreating: boolean
    reload: () => Promise<void>
    createProject: (name: string, audience: PressAudience) => Promise<boolean>
    rebuildIndex: () => Promise<void>
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
        async (name: string, audience: PressAudience): Promise<boolean> => {
            setIsCreating(true)
            const payload: CreatePressProjectRequest = { name, audience }
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

    const rebuildIndex = useCallback(async (): Promise<void> => {
        try {
            await request('host/command', 'zhai.rebuildIndex')
            toast.info('已开始重建索引，完成后列表自动刷新')
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    return { projects, status, error, isCreating, reload, createProject, rebuildIndex }
}
