/**
 * 工作流路由契约：宿主下发的场景事实（workflow/* 协议）与工作流页面标识。
 * 使用方：Webview 工作流页（src/webview/workflow/）与宿主侧 WorkflowRouter / AiChatViewProvider / DashboardViewProvider。
 * 复用约定：模块键取相对存储根的一级目录名，与索引库 files.path 及展示层 moduleOf 同口径。
 * 关键约束：字段由宿主归一化后填充，前端只负责解析与渲染，不自行读取配置或访问文件系统；
 * 前端回传的模块标识一律经 isOpenWorkflowRequest 收窄后再用，不得把路径形态字符串透传给宿主命令。
 */

/** 工作流页面标识：chat 为现有 AI 对话页，placeholder 为尚未接入专属页面的场景占位页 */
export type WorkflowId = 'chat' | 'placeholder'

/** 进入场景：module 为模块入口跳转，editorNote 为聚焦在笔记文档上，idle 为无场景 */
export type WorkflowSceneKind = 'module' | 'editorNote' | 'idle'

/** 无一级目录的顶层文件归入的模块键（与宿主侧读法同值） */
export const ROOT_MODULE_KEY = 'root'

/** 笔记模块键：该目录下的文档构成「笔记编辑场景」 */
export const NOTES_MODULE_KEY = 'notes'

/** 路由事实快照：宿主权威下发，前端不自造 */
export interface WorkflowContextState {
    scene: WorkflowSceneKind
    /** 当前模块键：相对存储根的一级目录名，顶层文件为 root */
    module: string
    /** 模块入口一次性指定的模块，未指定或已被消费为 null */
    requestedModule: string | null
}

/** workflow/open 请求：仪表盘入口跳转时携带的模块意图 */
export interface OpenWorkflowRequest {
    /** 目标模块键，形如 press / wechat */
    module: string
}

/** workflow/open 响应 */
export interface OpenWorkflowResult {
    opened: boolean
}

/** 判断是否为合法的路由事实快照（类型收窄辅助） */
export function isWorkflowContextState(payload: unknown): payload is WorkflowContextState {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { scene?: unknown; module?: unknown; requestedModule?: unknown }
    const isScene = candidate.scene === 'module' || candidate.scene === 'editorNote' || candidate.scene === 'idle'
    const isModule = typeof candidate.module === 'string' && candidate.module.length > 0
    const isRequested = candidate.requestedModule === null || typeof candidate.requestedModule === 'string'
    return isScene && isModule && isRequested
}

/**
 * 判断是否为合法的模块跳转请求（类型收窄辅助）。
 * 约束：模块键限定小写字母数字与连字符，从源头排除路径分隔符、盘符等形态，
 * 避免任意字符串经命令入口流入宿主。
 */
export function isOpenWorkflowRequest(payload: unknown): payload is OpenWorkflowRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const module = (payload as { module?: unknown }).module
    return typeof module === 'string' && /^[a-z][a-z0-9-]*$/.test(module)
}
