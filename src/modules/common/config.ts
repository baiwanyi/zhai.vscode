/**
 * 配置中心：集中读取 zhai.* 配置项与解析存储路径，避免各模块散落调用 getConfiguration。
 * 复用 VSCode contributes.configuration 全局/工作区两级机制，路径解析遵循 common.md 第 1.5 节存储根约定。
 * 关键约束：文档存储根与索引缓存目录分离——前者是用户资料（Markdown 主存储），后者是可随时重建的 SQLite 缓存。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

/** 未配置保存目录时使用的用户主目录子目录名 */
const DEFAULT_STORAGE_DIR = '.zhai'

/** 索引缓存目录名：全局存储下的固定文件夹名，库文件（index.db / ai.db）位于其中 */
const CACHE_DIR_NAME = 'zhai.vscode'

/** 插件全部配置项的强类型视图 */
export interface ZhaiConfig {
    /** 文档保存目录（空 = 用户主目录下的 .zhai） */
    rootPath: string
    indexExclude: string[]
    indexDebounceMs: number
    rebuildOnActivate: boolean
    searchLimit: number
    /** CodeBuddy 站点：登录与调用必须一致，切换后需重新登录 */
    aiCodebuddySite: CodebuddySite
    /** CodeBuddy 对话模型（CLI 认可的模型 id），空表示使用 CLI 默认模型 */
    aiCodebuddyModel: string
    aiTemperature: number
    aiMaxContextTokens: number
    aiDailyTokenBudget: number
    /** 添加上下文引用后是否自动聚焦 AI 对话面板 */
    aiAutoFocusOnContext: boolean
    /** 取名 AI 生成每日次数上限（本地生成不限） */
    namingAiDailyLimit: number
    /** 写作管理 AI 生成每日次数上限（人物外貌等一次性生成） */
    pressAiDailyLimit: number
    /** CodeBuddy 出图时驱动工具调用的对话模型，空表示使用通道默认模型 */
    imageCodebuddyModel: string
    /** 角色设定图尺寸，形如 768x1024 */
    imageSize: string
    /** 角色设定图每日生成次数上限 */
    imageDailyLimit: number
    telemetryEnabled: boolean
}

const SECTION = 'zhai'

/** CodeBuddy 站点：仅开放中国站（cn）与国际站（ai） */
export type CodebuddySite = 'cn' | 'ai'

/**
 * 收窄站点取值：非法值按中国站处理。
 * 关键约束：历史配置保存的是 china / international，读取时一并归一到 cn / ai，
 * 避免升级后站点被误判导致登录态与调用端点错配。
 */
function readCodebuddySite(value: string): CodebuddySite {
    if (value === 'ai' || value === 'international') {
        return 'ai'
    }
    return 'cn'
}

/** 读取当前生效的插件配置（每次调用即时求值，跟随用户修改） */
export function getZhaiConfig(): ZhaiConfig {
    const cfg = vscode.workspace.getConfiguration(SECTION)
    return {
        rootPath: cfg.get<string>('storage.rootPath', ''),
        indexExclude: cfg.get<string[]>('index.exclude', ['**/node_modules/**', '**/.git/**']),
        indexDebounceMs: cfg.get<number>('index.debounceMs', 500),
        rebuildOnActivate: cfg.get<boolean>('index.rebuildOnActivate', true),
        searchLimit: cfg.get<number>('search.limit', 50),
        aiCodebuddySite: readCodebuddySite(cfg.get<string>('ai.codebuddySite', 'cn')),
        aiCodebuddyModel: cfg.get<string>('ai.codebuddyModel', ''),
        aiTemperature: cfg.get<number>('ai.temperature', 0.7),
        aiMaxContextTokens: cfg.get<number>('ai.maxContextTokens', 8000),
        aiDailyTokenBudget: cfg.get<number>('ai.dailyTokenBudget', 500000),
        aiAutoFocusOnContext: cfg.get<boolean>('ai.autoFocusOnContext', true),
        namingAiDailyLimit: cfg.get<number>('naming.aiDailyLimit', 20),
        pressAiDailyLimit: cfg.get<number>('press.aiDailyLimit', 20),
        imageCodebuddyModel: cfg.get<string>('image.codebuddyModel', ''),
        imageSize: cfg.get<string>('image.size', '768x1024'),
        imageDailyLimit: cfg.get<number>('image.dailyLimit', 20),
        telemetryEnabled: cfg.get<boolean>('telemetry.enabled', false),
    }
}

/**
 * 规范化用户配置的本地路径：盘符路径统一为反斜杠写法。
 * 关键约束：Uri.file 仅在第三个字符为反斜杠时才补前导斜杠，正斜杠写法（D:/vault）会产出不带前导
 * 斜杠的相对路径，被 workspace.fs 以「无法解析具有相对文件路径的文件系统提供程序」拒绝。
 * 非盘符路径（UNC）保持原样，以免反斜杠化后破坏 authority 解析。
 */
function normalizeRootPath(rootPath: string): string {
    const trimmed = rootPath.trim()
    return /^[a-zA-Z]:[\\/]/.test(trimmed) ? trimmed.replace(/\//g, '\\') : trimmed
}

/**
 * 解析文档保存目录 URI：优先取配置值，未配置时回退到用户主目录下的 .zhai。
 * 两条分支都产出本地绝对路径后才交给 Uri.file，避免出现 workspace.fs 拒绝的相对路径。
 */
export function resolveStorageRoot(): vscode.Uri {
    const { rootPath } = getZhaiConfig()
    if (rootPath.trim().length > 0) {
        return vscode.Uri.file(normalizeRootPath(rootPath))
    }
    return vscode.Uri.file(path.join(os.homedir(), DEFAULT_STORAGE_DIR))
}

/**
 * 解析索引缓存目录 URI：取全局存储目录的兄弟目录，使文件夹名固定为 zhai.vscode。
 * 关键约束：不直接使用传入的 globalStorageUri 本身（其名由 publisher.name 决定，改扩展标识会连带迁移旧目录），
 * 目录位于文档存储根之外，删除后索引由自检自愈重建，不影响用户的 Markdown 资料。
 */
export function resolveCacheRoot(globalStorageUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(path.join(globalStorageUri.fsPath, '..', CACHE_DIR_NAME))
}
