/**
 * 工作流路由契约：宿主下发的场景事实（workflow/* 协议）与页内视图请求。
 * 使用方：Webview 工作流页（src/workflow/）与宿主侧 WorkflowRouter / AiChatViewProvider / DashboardViewProvider。
 * 复用约定：模块键取相对存储根的一级目录名，与索引库 files.path 及展示层 moduleOf 同口径；
 * projectDir 取 press/{作品名} 两段，仅由宿主从活跃文档路径推导，前端据此请求作品文档，不自行拼接路径。
 * 关键约束：字段由宿主归一化后填充，前端只负责解析与渲染，不自行读取配置或访问文件系统；
 * 前端回传的模块标识一律经 isOpenWorkflowRequest 收窄后再用，不得把路径形态字符串透传给宿主命令。
 */

/** 进入场景：editorNote 为聚焦在笔记文档上，idle 为无编辑器或索引外文档 */
export type WorkflowSceneKind = 'idle' | 'editorNote'

/** 无一级目录的顶层文件归入的模块键（与宿主侧读法同值） */
export const ROOT_MODULE_KEY = 'root'

/** 笔记模块键：该目录下的文档构成「笔记编辑场景」 */
export const NOTES_MODULE_KEY = 'notes'

/** 路由事实快照：宿主权威下发，前端不自造 */
export interface WorkflowContextState {
    scene: WorkflowSceneKind
    /** 当前模块键：相对存储根的一级目录名，顶层文件为 root */
    module: string
    /** 用户选定的模块：由仪表盘入口或侧边导航设置并在宿主持久保持，未选择为 null */
    selectedModule: string | null
    /** 当前打开的作品目录（相对存储根，形如 press/{作品名}），未打开作品为 null */
    projectDir: string | null
}

/**
 * 页内视图请求：宿主在一次操作后要求面板切到指定分区（如「添加到宅对话」后切到对话页）。
 * 与路由事实分开下发：事实描述「当前在哪」，视图请求表达「去哪」，混在一起会让一次性意图被持久化。
 * seq 单调递增，保证同一视图被连续请求时前端仍识别为新意图，不受「值未变化」的抑制。
 */
export interface WorkflowViewRequest {
    kind: 'view'
    /** 页内视图标识：目前与 press 的分区名同口径 */
    view: string
    seq: number
}

/** workflow/open 请求：模块入口携带的模块键 */
export interface OpenWorkflowRequest {
    /** 目标模块键，形如 press / wechat */
    module: string
}

/** workflow/open 响应 */
export interface OpenWorkflowResult {
    opened: boolean
}

/** workflow/reset 响应：清除模块选择并回到写作管理页的对话分区 */
export interface ResetWorkflowResult {
    cleared: boolean
}

/** 判断是否为合法的路由事实快照（类型收窄辅助） */
export function isWorkflowContextState(payload: unknown): payload is WorkflowContextState {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { scene?: unknown; module?: unknown; selectedModule?: unknown; projectDir?: unknown }
    const isScene = candidate.scene === 'idle' || candidate.scene === 'editorNote'
    const isModule = typeof candidate.module === 'string' && candidate.module.length > 0
    const isSelected = candidate.selectedModule === null || typeof candidate.selectedModule === 'string'
    const isProject = candidate.projectDir === null || typeof candidate.projectDir === 'string'
    return isScene && isModule && isSelected && isProject
}

/**
 * 判断是否为合法的页内视图请求（类型收窄辅助）。
 * 约束：视图标识沿用模块键的字符白名单，从源头排除路径片段与任意字符串。
 */
export function isWorkflowViewRequest(payload: unknown): payload is WorkflowViewRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { kind?: unknown; view?: unknown; seq?: unknown }
    return (
        candidate.kind === 'view' &&
        typeof candidate.view === 'string' &&
        /^[a-z][a-z0-9-]*$/.test(candidate.view) &&
        typeof candidate.seq === 'number' &&
        Number.isInteger(candidate.seq)
    )
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
