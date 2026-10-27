/**
 * 工作流路由事实：初次拉取宿主快照，随后跟随 workflow 通道广播更新，并维护用户手动覆盖。
 * 复用 @shared/utils/bridge 的请求与状态订阅，收窄逻辑取自 shared/types/workflow。
 * 关键约束：覆盖与生成它的场景指纹绑定，场景事实任一项变化即自动作废；
 * workflow 通道混走「路由事实」与「页内视图请求」两类载荷，按 kind 分流后再各自落 state；
 * 视图请求常驻 state 不清空——它按 seq 判新，页面重建后仍能落到宿主指定的分区；
 * 模块选定与清除的失败向上抛出，由页面就地提示，不在本层吞掉；
 * 宿主未就绪（或浏览器预览环境）时保留默认事实，页面照常可用。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isWorkflowContextState, isWorkflowViewRequest, ROOT_MODULE_KEY } from '@shared/types/workflow'
import type {
    OpenWorkflowRequest,
    OpenWorkflowResult,
    ResetWorkflowResult,
    WorkflowContextState,
    WorkflowId,
    WorkflowViewRequest,
} from '@shared/types/workflow'
import { onState, request } from '@shared/utils/bridge'
import type { WorkflowResolveReason } from '../core/routing'
import { contextFingerprint, resolveWorkflow } from '../core/routing'

/** 宿主未响应前的默认事实：无场景、无模块、未选定且未打开作品，解析结果落到初始页 */
const INITIAL_CONTEXT: WorkflowContextState = {
    scene: 'idle',
    module: ROOT_MODULE_KEY,
    selectedModule: null,
    projectDir: null,
}

/** 用户覆盖：连同生成时的场景指纹保存，指纹不匹配即视为过期 */
interface WorkflowOverride {
    fingerprint: string
    workflowId: WorkflowId
}

export interface WorkflowRoutingState {
    context: WorkflowContextState
    /** 宿主发起的页内视图请求：页面据 seq 判断是否为新一次跳转，未请求过为 null */
    viewRequest: WorkflowViewRequest | null
    workflowId: WorkflowId
    /** 解析命中来源，供排查与后续轻提示使用 */
    reason: WorkflowResolveReason
    /** 宿主路由事实是否已就绪：未就绪时宿主层渲染骨架，避免先闪出页面 */
    isReady: boolean
    /** 选定模块：宿主保存后广播新事实，本层只转发请求并向上抛出失败 */
    openModule: (module: string) => Promise<void>
    /** 清除模块选定：回到初始页 */
    resetModule: () => Promise<void>
    setOverride: (workflowId: WorkflowId) => void
}

export function useWorkflowRouting(): WorkflowRoutingState {
    const [context, setContext] = useState<WorkflowContextState>(INITIAL_CONTEXT)
    const [viewRequest, setViewRequest] = useState<WorkflowViewRequest | null>(null)
    const [isReady, setIsReady] = useState(false)
    const [override, setOverrideState] = useState<WorkflowOverride | null>(null)

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

    const fingerprint = contextFingerprint(context)
    const activeOverride = override !== null && override.fingerprint === fingerprint ? override.workflowId : null

    const setOverride = useCallback(
        (workflowId: WorkflowId): void => {
            setOverrideState({ fingerprint, workflowId })
        },
        [fingerprint],
    )

    const openModule = useCallback(async (module: string): Promise<void> => {
        const payload: OpenWorkflowRequest = { module }
        await request<OpenWorkflowResult>('workflow/open', payload)
    }, [])

    const resetModule = useCallback(async (): Promise<void> => {
        await request<ResetWorkflowResult>('workflow/reset')
    }, [])

    const resolved = useMemo(() => resolveWorkflow({ context, override: activeOverride }), [context, activeOverride])

    return {
        context,
        viewRequest,
        workflowId: resolved.workflowId,
        reason: resolved.reason,
        isReady,
        openModule,
        resetModule,
        setOverride,
    }
}
