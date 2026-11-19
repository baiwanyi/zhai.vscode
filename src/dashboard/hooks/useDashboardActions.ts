/**
 * 仪表盘宿主动作：按领域组合笔记、笔记本与回收站动作，统一在途态并承载工作流跳转与微博面板打开。
 * 复用 useNoteActions / useNotebookActions / useTrashActions 承载各领域请求，usePendingAction 统一计数，
 * 请求与提示基础设施见 ../core/actionRunner；结果提示在数据层即时发出，页面不再渲染提示行。
 * 关键约束：pendingAction 只表示最后开始的动作，仅用于整体忙碌态；判断具体动作是否在途必须走 isPending，
 * 否则并发（如删除进行中又置顶）会让弹窗的提交态提前失效；
 * 三个子 Hook 共享同一 tracker，不能各自持有在途状态，否则忙碌态会提前解锁；
 * 打开笔记、工作流跳转与微博面板打开不占用在途态，避免顶栏操作区被整体禁用。
 */
import { useCallback } from 'react'
import type { OpenWorkflowRequest } from '@shared/types/workflow'
import { useNoteActions } from './useNoteActions'
import { useNotebookActions } from './useNotebookActions'
import { usePendingAction } from './usePendingAction'
import { useTrashActions } from './useTrashActions'
import type { NoteActionsState } from './useNoteActions'
import type { NotebookActionsState } from './useNotebookActions'
import type { PendingAction } from './usePendingAction'
import type { TrashActionsState } from './useTrashActions'
import { callHostRequest } from '../core/actionRunner'

export type { PendingAction } from './usePendingAction'

export interface DashboardActionsState extends NoteActionsState, NotebookActionsState, TrashActionsState {
    /** 最后开始的在途动作：null 表示没有动作在途 */
    pendingAction: PendingAction | null
    /** 指定动作是否在途：并发场景下的准确判定 */
    isPending: (action: PendingAction) => boolean
    openWorkflow: (module: string) => Promise<void>
    /** 打开微博面板：在编辑区新开独立页，失败仅提示 */
    openWeibo: () => Promise<void>
}

export function useDashboardActions(onCompleted: () => Promise<void>): DashboardActionsState {
    const tracker = usePendingAction()
    const noteActions = useNoteActions({ tracker, onCompleted })
    const notebookActions = useNotebookActions({ tracker, onCompleted })
    const trashActions = useTrashActions({ tracker, onCompleted })

    /**
     * 跳转工作流页：仅传递模块意图，由工作流页按模块类型与场景决定渲染真实页面或占位页。
     * 失败仅提示，不改动仪表盘自身状态，也不占用在途态。
     */
    const openWorkflow = useCallback(async (module: string): Promise<void> => {
        const payload: OpenWorkflowRequest = { module }
        await callHostRequest('workflow/open', payload)
    }, [])

    /**
     * 打开微博面板：宿主在编辑区创建独立 webview 页，面板激活后会自行上报「当前活跃面板」，
     * 工作流区因此跟随标签切到微博语境——这里不再额外发 selectModule，避免留下持久选定。
     */
    const openWeibo = useCallback(async (): Promise<void> => {
        await callHostRequest('weibo/open')
    }, [])

    return {
        pendingAction: tracker.pendingAction,
        isPending: tracker.isPending,
        ...noteActions,
        ...notebookActions,
        ...trashActions,
        openWorkflow,
        openWeibo,
    }
}
