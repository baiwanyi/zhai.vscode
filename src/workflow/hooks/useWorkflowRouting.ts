/**
 * 工作流路由事实：初次拉取宿主快照，随后跟随 workflow 通道广播更新。
 * 复用 @shared/utils/bridge 的请求与状态订阅，收窄逻辑取自 shared/types/workflow。
 * 关键约束：所有内容都落到写作管理页、默认分区即 AI 对话，因此不再做模块与场景分流，也不维护页内覆盖；
 * workflow 通道混走「路由事实」与「页内视图请求」两类载荷，按 kind 分流后再各自落 state；
 * 视图请求常驻 state 不清空——它按 seq 判新，页面重建后仍能落到宿主指定的分区；
 * 宿主未就绪（或浏览器预览环境）时保留默认事实，页面照常可用。
 */
import { useEffect, useState } from 'react'
import { isWorkflowContextState, isWorkflowViewRequest, ROOT_MODULE_KEY } from '@shared/types/workflow'
import type { WorkflowContextState, WorkflowViewRequest } from '@shared/types/workflow'
import { onState, request } from '@shared/utils/bridge'

/** 宿主未响应前的默认事实：无场景、无模块、未打开作品，页面按此先渲染骨架再补齐 */
const INITIAL_CONTEXT: WorkflowContextState = {
    scene: 'idle',
    module: ROOT_MODULE_KEY,
    selectedModule: null,
    projectDir: null,
}

export interface WorkflowRoutingState {
    context: WorkflowContextState
    /** 宿主发起的页内视图请求：页面据 seq 判断是否为新一次跳转，未请求过为 null */
    viewRequest: WorkflowViewRequest | null
    /** 宿主路由事实是否已就绪：未就绪时宿主层渲染骨架，避免先闪出页面 */
    isReady: boolean
}

export function useWorkflowRouting(): WorkflowRoutingState {
    const [context, setContext] = useState<WorkflowContextState>(INITIAL_CONTEXT)
    const [viewRequest, setViewRequest] = useState<WorkflowViewRequest | null>(null)
    const [isReady, setIsReady] = useState(false)

    useEffect(() => {
        let isDisposed = false
        const load = async (): Promise<void> => {
            try {
                const snapshot = await request<WorkflowContextState>('workflow/state')
                if (!isDisposed && isWorkflowContextState(snapshot)) {
                    setContext(snapshot)
                }
            } catch {
                // 宿主未就绪时按默认事实渲染，待广播补齐；此处不打断页面
            } finally {
                if (!isDisposed) {
                    setIsReady(true)
                }
            }
        }
        void load()
        const unsubscribe = onState((message) => {
            if (message.channel !== 'workflow') {
                return
            }
            // 同一通道混走两类载荷：页内视图请求是一次性意图，路由事实是当前所在；先按 kind 分流
            if (isWorkflowViewRequest(message.payload)) {
                setViewRequest(message.payload)
                return
            }
            if (isWorkflowContextState(message.payload)) {
                setContext(message.payload)
            }
        })
        return (): void => {
            isDisposed = true
            unsubscribe()
        }
    }, [])

    return { context, viewRequest, isReady }
}
