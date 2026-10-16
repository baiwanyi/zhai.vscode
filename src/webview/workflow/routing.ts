/**
 * 工作流路由规则：模块类型与进入场景到工作流页面的映射表，以及唯一的解析函数。
 * 复用约定：模块键与宿主 WorkflowRouter 同口径（相对存储根一级目录名）；本文件不依赖组件，可直接单测。
 * 关键约束：模块意图（入口显式指定或模块场景）优先于场景默认，笔记编辑场景按场景表回落占位页；
 * 用户手动覆盖优先于一切，其有效性由调用方按场景事实是否变化判定。
 */
import type { WorkflowContextState, WorkflowId, WorkflowSceneKind } from '@/shared/types/workflow'

/** 模块 → 工作流页面：press（写作管理）复用现有 AI 对话页，wechat（公众号管理）暂用占位页 */
export const MODULE_WORKFLOW: Readonly<Record<string, WorkflowId>> = {
    press: 'chat',
    wechat: 'placeholder',
}

/** 场景 → 工作流页面：笔记编辑场景暂用占位页，其余场景回落模块映射 */
export const SCENE_WORKFLOW: Readonly<Record<WorkflowSceneKind, WorkflowId>> = {
    module: 'chat',
    editorNote: 'placeholder',
    idle: 'chat',
}

/** 兜底工作流页：当前唯一已完整落地的页面 */
export const FALLBACK_WORKFLOW: WorkflowId = 'chat'

/** 解析命中来源，用于轻提示与问题排查 */
export type WorkflowResolveReason = 'override' | 'requested' | 'module' | 'scene' | 'fallback'

export interface ResolveInput {
    context: WorkflowContextState
    /** 用户在工作流页内的手动覆盖；仅在其绑定的场景事实未变化时传入非空值 */
    override: WorkflowId | null
}

export interface ResolveResult {
    workflowId: WorkflowId
    reason: WorkflowResolveReason
}

/**
 * 解析当前应展示的工作流页面。
 * 顺序：用户覆盖 → 入口显式模块 → 模块场景映射 → 笔记编辑场景 → 模块兜底 → 默认页。
 */
export function resolveWorkflow({ context, override }: ResolveInput): ResolveResult {
    if (override !== null) {
        return { workflowId: override, reason: 'override' }
    }
    const byModule = MODULE_WORKFLOW[context.module]
    if (context.requestedModule !== null) {
        const requested = MODULE_WORKFLOW[context.requestedModule]
        if (requested !== undefined) {
            return { workflowId: requested, reason: 'requested' }
        }
    }
    if (context.scene === 'module' && byModule !== undefined) {
        return { workflowId: byModule, reason: 'module' }
    }
    if (context.scene === 'editorNote') {
        return { workflowId: SCENE_WORKFLOW.editorNote, reason: 'scene' }
    }
    if (byModule !== undefined) {
        return { workflowId: byModule, reason: 'module' }
    }
    return { workflowId: FALLBACK_WORKFLOW, reason: 'fallback' }
}

/** 场景事实指纹：用户覆盖只对生成该覆盖时的场景有效，场景变化后自动作废 */
export function contextFingerprint(context: WorkflowContextState): string {
    return `${context.scene}|${context.module}|${context.requestedModule ?? ''}`
}
