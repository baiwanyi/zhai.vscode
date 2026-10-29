/**
 * 配置中心：集中读取 zhai.* 配置项与解析存储路径，避免各模块散落调用 getConfiguration。
 * 复用 VSCode contributes.configuration 全局/工作区两级机制，路径解析遵循 common.md 第 1.5 节存储根约定。
 * 关键约束：文档存储根与索引缓存目录分离——前者是用户资料（Markdown 主存储），后者是可随时重建的 SQLite 缓存；
 * 提示词目录可单独配置，未配置时回落到存储根下的 prompt，配置后读写都跟随新目录。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

/** 未配置保存目录时使用的用户主目录子目录名 */
const DEFAULT_STORAGE_DIR = '.zhai'

/** 索引缓存目录名：全局存储下的固定文件夹名，库文件（index.db / ai.db）位于其中 */
const CACHE_DIR_NAME = 'zhai.vscode'

/** 提示词目录名：未配置 prompt.rootPath 时占位于存储根之下 */
const PROMPT_DIR = 'prompt'

/** 插件全部配置项的强类型视图 */
export interface ZhaiConfig {
    /** 文档保存目录（空 = 用户主目录下的 .zhai） */
    rootPath: string
    /** 提示词目录（空 = 文档保存目录下的 prompt）：其下分 tags / images / rules */
    promptRootPath: string
    indexExclude: string[]
    indexDebounceMs: number
    rebuildOnActivate: boolean
    searchLimit: number
    /** CodeBuddy 站点：登录与调用必须一致，切换后需重新登录 */
    aiCodebuddySite: CodebuddySite
    aiMaxContextTokens: number
    /** 单次生成的输出 token 上限：过大则单次成本失控，过小会截断长回答 */
    aiMaxCompletionTokens: number
    aiDailyTokenBudget: number
    /** 取名 AI 生成每日次数上限（本地生成不限） */
    namingAiDailyLimit: number
    /** 写作管理 AI 生成每日次数上限（人物外貌等一次性生成） */
    pressAiDailyLimit: number
    /** 语义归纳每日调用次数上限（人物卡、设定、大纲等按需提取同样计入），0 表示不限制；与 pressAiDailyLimit 分开计数 */
    pressImportAiDailyLimit: number
    /** 是否在设定、角色、大纲内容变更时自动保存作品快照 */
    pressSnapshotEnabled: boolean
    /** 自动快照的最小间隔秒数：同一作品两次自动快照之间的最短时间 */
    pressSnapshotIntervalSeconds: number
    /** 章节正文自动快照的最小间隔秒数：按章独立计数，正文写作频率远高于改设定 */
    pressSnapshotChapterIntervalSeconds: number
    /** 角色设定图尺寸，形如 768x1024 */
    imageSize: string
    /** 角色设定图每日生成次数上限 */
    imageDailyLimit: number
    /** 校对正文长度上限：超出后截断，只检查前 maxChars 个字符 */
    proofreadMaxChars: number
    /** AI 校对每日次数上限（0 或负数表示不限） */
    proofreadAiDailyLimit: number
    /** AI 校对单批字符数：过小会切出大量批次，过大则单次响应变慢 */
    proofreadBatchChars: number
    /** AI 特征检测（朱雀）每日次数上限（0 或负数表示不限） */
    proofreadZhuqueDailyLimit: number
    telemetryEnabled: boolean
}

const SECTION = 'zhai'

/** 自动快照默认间隔秒数：与产品侧约定的 60s 一致 */
const DEFAULT_SNAPSHOT_INTERVAL_SECONDS = 60

/** 自动快照间隔下限：低于此值时快照本身就变成高频写盘，失去节流意义 */
const MIN_SNAPSHOT_INTERVAL_SECONDS = 5

/** 自动快照间隔上限：一小时一版已是兜底语义，再大等于关闭 */
const MAX_SNAPSHOT_INTERVAL_SECONDS = 3600

/** 章节自动快照默认间隔秒数：正文写作频率高，比结构化文档宽松得多 */
const DEFAULT_CHAPTER_SNAPSHOT_INTERVAL_SECONDS = 300

/** 章节自动快照间隔下限：低于此值时一章内会堆出上百版 */
const MIN_CHAPTER_SNAPSHOT_INTERVAL_SECONDS = 30

/** 章节自动快照间隔上限：一小时一版已是兜底语义，再大等于关闭 */
const MAX_CHAPTER_SNAPSHOT_INTERVAL_SECONDS = 3600

/** 收敛整数配置：非法值回落默认，越界值夹到上下限内 */
function readBoundedInt(value: number, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.min(Math.max(Math.floor(value), min), max)
}

/** 收敛秒数配置：与整数口径一致，单独命名以标明入参语义 */
function readBoundedSeconds(value: number, fallback: number, min: number, max: number): number {
    return readBoundedInt(value, fallback, min, max)
}

/** 收敛自动快照间隔：非法值回落默认，越界值夹到上下限内 */
function readSnapshotInterval(value: number): number {
    return readBoundedSeconds(
        value,
        DEFAULT_SNAPSHOT_INTERVAL_SECONDS,
        MIN_SNAPSHOT_INTERVAL_SECONDS,
        MAX_SNAPSHOT_INTERVAL_SECONDS,
    )
}

/** 单次生成上限：默认 2048，低于 256 会明显截断，高于 32000 单次成本失控 */
function readCompletionTokens(value: number): number {
    return readBoundedInt(value, 2048, 256, 32000)
}

/** 收敛章节自动快照间隔：与结构化文档分开取值，互不影响 */
function readChapterSnapshotInterval(value: number): number {
    return readBoundedSeconds(
        value,
        DEFAULT_CHAPTER_SNAPSHOT_INTERVAL_SECONDS,
        MIN_CHAPTER_SNAPSHOT_INTERVAL_SECONDS,
        MAX_CHAPTER_SNAPSHOT_INTERVAL_SECONDS,
    )
}

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
        promptRootPath: cfg.get<string>('prompt.rootPath', ''),
        indexExclude: cfg.get<string[]>('index.exclude', ['**/node_modules/**', '**/.git/**']),
        indexDebounceMs: cfg.get<number>('index.debounceMs', 500),
        rebuildOnActivate: cfg.get<boolean>('index.rebuildOnActivate', true),
        searchLimit: cfg.get<number>('search.limit', 50),
        aiCodebuddySite: readCodebuddySite(cfg.get<string>('ai.codebuddySite', 'cn')),
        aiMaxContextTokens: cfg.get<number>('ai.maxContextTokens', 8000),
        aiMaxCompletionTokens: readCompletionTokens(cfg.get<number>('ai.maxCompletionTokens', 2048)),
        aiDailyTokenBudget: cfg.get<number>('ai.dailyTokenBudget', 500000),
        namingAiDailyLimit: cfg.get<number>('naming.aiDailyLimit', 20),
        pressAiDailyLimit: cfg.get<number>('press.aiDailyLimit', 20),
        pressImportAiDailyLimit: cfg.get<number>('press.importAiDailyLimit', 0),
        pressSnapshotEnabled: cfg.get<boolean>('press.snapshot.enabled', true),
        pressSnapshotIntervalSeconds: readSnapshotInterval(cfg.get<number>('press.snapshot.intervalSeconds', 60)),
        pressSnapshotChapterIntervalSeconds: readChapterSnapshotInterval(
            cfg.get<number>('press.snapshot.chapterIntervalSeconds', 300),
        ),
        imageSize: cfg.get<string>('image.size', '768x1024'),
        imageDailyLimit: cfg.get<number>('image.dailyLimit', 20),
        proofreadMaxChars: readBoundedInt(cfg.get<number>('proofread.maxChars', 20000), 20000, 1000, 200000),
        proofreadAiDailyLimit: readBoundedInt(cfg.get<number>('proofread.aiDailyLimit', 30), 30, 0, 1000),
        proofreadBatchChars: readBoundedInt(cfg.get<number>('proofread.batchChars', 1200), 1200, 400, 4000),
        proofreadZhuqueDailyLimit: readBoundedInt(cfg.get<number>('proofread.zhuqueDailyLimit', 10), 10, 0, 500),
        telemetryEnabled: cfg.get<boolean>('telemetry.enabled', false),
    }
}

/**
 * 规范化用户配置的本地路径：盘符路径统一为「反斜杠 + 小写盘符」写法。
 * 关键约束：Uri.file 仅在第三个字符为反斜杠时才补前导斜杠，正斜杠写法（D:/vault）会产出不带前导
 * 斜杠的相对路径，被 workspace.fs 以「无法解析具有相对文件路径的文件系统提供程序」拒绝；
 * 盘符还须统一小写——同一目录在用户设置与工作区设置里常写成 D: / d: 两种形态，
 * 而 webview 的 localResourceRoots 与资源地址是逐字符比对的，大小写不一致会让预览图请求被判 401。
 * 非盘符路径（UNC）保持原样，以免反斜杠化后破坏 authority 解析。
 */
function normalizeRootPath(rootPath: string): string {
    const trimmed = rootPath.trim()
    if (!/^[a-zA-Z]:[\\/]/.test(trimmed)) {
        return trimmed
    }
    const unified = trimmed.replace(/\//g, '\\')
    return unified.charAt(0).toLowerCase() + unified.slice(1)
}

/**
 * 解析文档保存目录 URI：优先取配置值，未配置时回退到用户主目录下的 .zhai。
 * 两条分支都产出本地绝对路径后才交给 Uri.file，避免出现 workspace.fs 拒绝的相对路径；
 * 默认分支同样走 normalizeRootPath，保证盘符口径与配置分支一致。
 */
export function resolveStorageRoot(): vscode.Uri {
    const { rootPath } = getZhaiConfig()
    if (rootPath.trim().length > 0) {
        return vscode.Uri.file(normalizeRootPath(rootPath))
    }
    return vscode.Uri.file(normalizeRootPath(path.join(os.homedir(), DEFAULT_STORAGE_DIR)))
}

/**
 * 解析提示词目录 URI：优先取 prompt.rootPath，未配置时回落到存储根下的 prompt。
 * 关键约束：其下 tags / images / rules 三个子目录由调用方拼接（见 common/promptRoot），
 * 改这一处即同时改变读写位置；配置每次调用即时求值，切换目录后无需重启，重开面板即可看到新库。
 */
export function resolvePromptRoot(): vscode.Uri {
    const { promptRootPath } = getZhaiConfig()
    if (promptRootPath.trim().length > 0) {
        return vscode.Uri.file(normalizeRootPath(promptRootPath))
    }
    return vscode.Uri.joinPath(resolveStorageRoot(), PROMPT_DIR)
}

/**
 * 解析索引缓存目录 URI：取全局存储目录的兄弟目录，使文件夹名固定为 zhai.vscode。
 * 关键约束：不直接使用传入的 globalStorageUri 本身（其名由 publisher.name 决定，改扩展标识会连带迁移旧目录），
 * 目录位于文档存储根之外，删除后索引由自检自愈重建，不影响用户的 Markdown 资料。
 */
export function resolveCacheRoot(globalStorageUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(path.join(globalStorageUri.fsPath, '..', CACHE_DIR_NAME))
}
