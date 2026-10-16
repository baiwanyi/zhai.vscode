/**
 * 工作流路由事实：初次拉取宿主快照，随后跟随 workflow 通道广播更新，并维护用户手动覆盖。
 * 复用 ../../bridge 的请求与状态订阅，收窄逻辑取自 shared/types/workflow。
 * 关键约束：覆盖与生成它的场景指纹绑定，场景事实任一项变化即自动作废，避免长期压住场景默认；
 * 宿主未就绪（或浏览器预览环境）时保留默认场景，页面照常可用。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isWorkflowContextState, ROOT_MODULE_KEY } from '@/shared/types/workflow'
import type { WorkflowContextState, WorkflowId } from '@/shared/types/workflow'
import type { WorkflowResolveReason } from '../routing'
import { onState, request } from '../../bridge'
import { contextFingerprint, resolveWorkflow } from '../routing'

/** 宿主未响应前的默认事实：无场景，解析结果回落到对话页 */
const INITIAL_CONTEXT: WorkflowContextState = {
    scene: 'idle',
    module: ROOT_MODULE_KEY,
    requestedModule: null,
}

/** 用户覆盖：连同生成时的场景指纹保存，指纹不匹配即视为过期 */
interface WorkflowOverride {
    fingerprint: string
    workflowId: WorkflowId
}

export interface WorkflowRoutingState {
    context: WorkflowContextState
    workflowId: WorkflowId
    /** 解析命中来源，供排查与后续轻提示使用 */
    reason: WorkflowResolveReason
    /** 宿主路由事实是否已就绪：未就绪时宿主层渲染骨架，避免先闪出对话页 */
    isReady: boolean
    setOverride: (workflowId: WorkflowId) => void
}

export function useWorkflowRouting(): WorkflowRoutingState {
    const [context, setContext] = useState<WorkflowContextState>(INITIAL_CONTEXT)
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
                // 宿主未就绪时按默认场景渲染，待广播补齐；此处不打断页面
            } finally {
                if (!isDisposed) {
                    setIsReady(true)
                }
            }
        }
        void load()
        const unsubscribe = onState((message) => {
            if (message.channel !== 'workflow' || !isWorkflowContextState(message.payload)) {
                return
            }
            setContext(message.payload)
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

    const resolved = useMemo(() => resolveWorkflow({ context, override: activeOverride }), [context, activeOverride])

    return {
        context,
        workflowId: resolved.workflowId,
        reason: resolved.reason,
        isReady,
        setOverride,
    }
}
