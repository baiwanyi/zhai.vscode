/**
 * 工作流路由规则：模块类型与进入场景到工作流页面的映射表，以及唯一的解析函数。
 * 复用约定：模块键与宿主 WorkflowRouter 同口径（相对存储根一级目录名）；本文件不依赖组件，可直接单测。
 * 关键约束：用户选定的模块优先于场景默认；笔记编辑场景优先于模块兜底；未选择模块且无场景时落到初始页；
 * 用户手动覆盖优先于一切，其有效性由调用方按场景事实是否变化判定。
 */
import { ROOT_MODULE_KEY } from '@shared/types/workflow'
import type { WorkflowContextState, WorkflowId, WorkflowSceneKind } from '@shared/types/workflow'

/** 模块 → 工作流页面：已接入模块各用 layout/ 下的专属页面（页面内部再组合 AI 对话等能力），未登记模块回落到占位页 */
export const MODULE_WORKFLOW: Readonly<Record<string, WorkflowId>> = {
    press: 'press',
    wechat: 'wechat',
    notes: 'note',
}

/** 模块 → 模块标题：占位页与初始页据此区分模块，未登记的模块回退显示模块键本身 */
export const MODULE_LABEL: Readonly<Record<string, string>> = {
    press: '写作管理',
    wechat: '公众号管理',
    notes: '笔记',
    reader: '阅读',
    [ROOT_MODULE_KEY]: '根目录',
}

/** 初始页标识：未选定模块时的落点，同时是模块选择入口（宿主据此决定是否展示切换浮层） */
export const HOME_WORKFLOW: WorkflowId = 'home'

/** 场景 → 工作流页面：笔记编辑场景进笔记页，无场景（无编辑器）进初始页 */
export const SCENE_WORKFLOW: Readonly<Record<WorkflowSceneKind, WorkflowId>> = {
    editorNote: 'note',
    idle: HOME_WORKFLOW,
}

/** 兜底工作流页：无模块、无场景、无选择时展示初始页，引导用户选择模块 */
export const FALLBACK_WORKFLOW: WorkflowId = HOME_WORKFLOW

/** 解析命中来源，用于轻提示与问题排查 */
export type WorkflowResolveReason = 'override' | 'selected' | 'module' | 'scene' | 'fallback'

export interface ResolveInput {
    context: WorkflowContextState
    /** 用户在工作流页内的手动覆盖；仅在其绑定的场景事实未变化时传入非空值 */
    override: WorkflowId | null
}

export interface ResolveResult {
    workflowId: WorkflowId
    reason: WorkflowResolveReason
}

/** 取模块标题：未登记的模块回退为模块键本身，保证占位页总能说明是哪个模块 */
export function readModuleLabel(module: string): string {
    return MODULE_LABEL[module] ?? module
}

/**
 * 解析当前应展示的工作流页面。
 * 顺序：用户覆盖 → 用户选定模块 → 笔记编辑场景 → 当前文档模块映射 → 未接入模块占位 → 场景默认（无模块时为初始页）。
 */
export function resolveWorkflow({ context, override }: ResolveInput): ResolveResult {
    if (override !== null) {
        return { workflowId: override, reason: 'override' }
    }
    if (context.selectedModule !== null) {
        const selected = MODULE_WORKFLOW[context.selectedModule]
        if (selected !== undefined) {
            return { workflowId: selected, reason: 'selected' }
        }
        return { workflowId: 'placeholder', reason: 'selected' }
    }
    if (context.scene === 'editorNote') {
        return { workflowId: SCENE_WORKFLOW.editorNote, reason: 'scene' }
    }
    const byModule = MODULE_WORKFLOW[context.module]
    if (byModule !== undefined) {
        return { workflowId: byModule, reason: 'module' }
    }
    if (context.module !== ROOT_MODULE_KEY) {
        return { workflowId: 'placeholder', reason: 'module' }
    }
    const byScene = SCENE_WORKFLOW[context.scene]
    if (byScene !== undefined) {
        return { workflowId: byScene, reason: 'scene' }
    }
    return { workflowId: FALLBACK_WORKFLOW, reason: 'fallback' }
}

/** 场景事实指纹：用户覆盖只对生成该覆盖时的场景有效，场景变化后自动作废 */
export function contextFingerprint(context: WorkflowContextState): string {
    return `${context.scene}|${context.module}|${context.selectedModule ?? ''}`
}
