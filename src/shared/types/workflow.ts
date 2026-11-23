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

/**
 * 公众号模块键：与 wechat.db、wechat/ 目录同名。
 * 关键约束：公众号页走仪表盘页内路由，不经过「打开 wechat/ 文档」这一步，
 * 因此侧栏六分区只能靠「用户选定模块」这条状态出现，常量放 shared 供两端共用。
 */
export const WECHAT_MODULE_KEY = 'wechat'

/**
 * 微博模块键：微博页在编辑区独立面板里打开，不存在 weibo/ 文档目录，
 * 侧栏只能靠「用户选定模块」这条状态切到微博语境（AI 对话），常量放 shared 供两端共用。
 */
export const WEIBO_MODULE_KEY = 'weibo'

/**
 * 微博编辑区面板的 viewType：宿主创建面板与工作流路由识别「当前活跃标签是微博」共用同一份值。
 * 关键约束：该标识只用于面板归属，不是文档目录名，不得参与路径拼接。
 */
export const WEIBO_PANEL_VIEW_TYPE = 'zhai.weibo'

/** 路由事实快照：宿主权威下发，前端不自造 */
export interface WorkflowContextState {
    scene: WorkflowSceneKind
    /** 当前模块键：相对存储根的一级目录名，顶层文件为 root */
    module: string
    /**
     * 用户选定的模块：由仪表盘入口或侧边导航设置，未选择为 null。
     * 关键约束：该选定只在「选定当时的活跃文档」上有效，用户切到别的文档后宿主会清空它，
     * 避免残留的模块压住当前文档的归属（否则菜单不随文档切换）。
     */
    selectedModule: string | null
    /** 当前打开的作品目录（相对存储根，形如 press/{作品名}），未打开作品为 null */
    projectDir: string | null
    /**
     * 当前活跃文档的相对路径（形如 notes/{笔记名}.md），无活跃文档或文档不属于当前作品时为 null。
     * 对话粒度：笔记以本字段为会话作用域键（每篇一份），公众号由本字段解析批次目录（每批次一份），
     * 作品按 projectDir 聚合（整个作品一份，不使用本字段）。
     */
    docPath: string | null
    /**
     * 当前活跃文档是否为 Markdown：工作流区只服务 md 文档，非 md 文档下整个工作流区不可用。
     * 关键约束：由宿主按活跃文档扩展名判定并下发，前端不得自行从路径推断，
     * 否则焦点离开编辑器、文档为富文本或根外路径时两侧口径会漂移。
     */
    isMarkdown: boolean
}

/** Markdown 文档判定：与自定义编辑器的 *.md 选择器同口径，工作流区与编辑器共用这一个判据 */
export function isMarkdownPath(path: string | null): boolean {
    return path !== null && path.toLowerCase().endsWith('.md')
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
    const candidate = payload as {
        scene?: unknown
        module?: unknown
        selectedModule?: unknown
        projectDir?: unknown
        docPath?: unknown
        isMarkdown?: unknown
    }
    const isScene = candidate.scene === 'idle' || candidate.scene === 'editorNote'
    const isModule = typeof candidate.module === 'string' && candidate.module.length > 0
    const isSelected = candidate.selectedModule === null || typeof candidate.selectedModule === 'string'
    const isProject = candidate.projectDir === null || typeof candidate.projectDir === 'string'
    const isDoc = candidate.docPath === null || typeof candidate.docPath === 'string'
    return isScene && isModule && isSelected && isProject && isDoc && typeof candidate.isMarkdown === 'boolean'
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
