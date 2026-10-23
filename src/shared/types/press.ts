/**
 * 作品契约：仪表盘 /press 页的作品摘要、创建、打开、卷重命名/删除与章节删除/移动的请求结构，
 * TXT 作品导入的候选、启动与进度结构，语义归纳与按工作台入口分别提取设定 / 大纲 / 人物卡的结构，
 * 导入素材抽取（press/analyze）的统计结构，目标读者枚举，
 * 以及人物外貌生成（pressAi/aiAppearance）与角色设定图（pressAi/generatePortrait、listPortraits、deletePortrait）的契约。
 * 提取类草案统一按「世界构建 / 情节脉络 / 人物全貌」三个维度铺字段：设定含世界观、地理、势力、规则体系与核心概念；
 * 大纲含卷目标、情节脉络、关键转折与逐章节拍、出场人物；人物卡含别名、年龄、外貌、背景与关系明细。
 * 使用方：仪表盘 Webview 的作品列表与宿主侧 DashboardViewProvider、modules/press 服务；
 * 外貌与角色卡契约同时被写作管理页的人物弹窗、宿主 PressAiService 与 PortraitService 使用。
 * 复用约定：dirPath 取相对存储根口径（press/{作品名}），与索引库 files.path 同源；作品名即目录名。
 * 关键约束：前端传入的作品名与目录路径均不可信，宿主须先经名称白名单校验或索引库回查后才可触达文件系统；
 * 导入的源文件路径由宿主签发 token 保存，前端只回传 token，杜绝 Webview 伪造路径读取任意文件；
 * 目标读者枚举只此一份，前端选项与落盘 Frontmatter 共用，避免两处口径分叉；
 * 草案字段只承载模型输出，枚举归一与「只填空字段」的合并策略由 Webview 决定，宿主不感知界面枚举；
 * 外貌生成入参同样不可信，宿主须重新裁剪长度后才会进入提示词。
 */

/** 目标读者：写入 README Frontmatter 的 audience，同时作为添加作品时的唯一选项来源 */
export const PRESS_AUDIENCES = ['男频', '女频'] as const

/** 目标读者取值 */
export type PressAudience = (typeof PRESS_AUDIENCES)[number]

/** 未指定目标读者时的默认值 */
export const DEFAULT_PRESS_AUDIENCE: PressAudience = '男频'

/**
 * 作品内的导入工作目录名：素材抽取与 AI 初稿的暂存处，平铺在该目录下。
 * 关键约束：不属于作品内容，索引与字数统计必须排除，否则作品字数会虚高。
 */
export const PRESS_IMPORT_DIR = '_import'

/** 作品摘要：宿主按索引库聚合，一部作品对应 press/ 下的一个目录 */
export interface PressProjectSummary {
    /** 目录名即作品名 */
    name: string
    /** 相对存储根的作品目录，形如 press/【小说名】 */
    dirPath: string
    /** 是否存在作品根 README.md（打开作品的落点） */
    hasReadme: boolean
    /** Chapter 下的章节文档数，兼容分卷层级 */
    chapterCount: number
    /** 作品目录下全部文档的字数合计 */
    wordCount: number
    /** 作品目录内最新的文档修改时间（ISO 8601） */
    mtime: string
}

/** press/create 请求：新建作品并生成骨架 */
export interface CreatePressProjectRequest {
    /** 作品名，同时作为目录名，须通过宿主名称白名单校验 */
    name: string
    /** 可选目标读者，缺省或非法值回落为「男频」 */
    audience?: string
}

/** press/create 响应 */
export interface CreatePressProjectResult {
    /** 相对存储根的作品目录，用于前端定位新条目 */
    dirPath: string
    /** 作品标题，与目录名一致 */
    title: string
}

/** press/open 请求：打开指定作品的 README.md */
export interface OpenPressProjectRequest {
    /** 相对存储根的作品目录，须已在索引库中存在 */
    dirPath: string
}

/** press/open 响应 */
export interface OpenPressProjectResult {
    opened: boolean
}

/** 章节条目：Chapter/ 下的一个 Markdown 文档 */
export interface PressChapterEntry {
    /** 相对存储根路径，形如 press/剑来/Chapter/01-初见.md */
    path: string
    /** 展示标题：文档内标题优先，缺失时用去序号前缀的文件名 */
    title: string
    /** 文档字数，取自索引库 */
    wordCount: number
    /** 文档最近修改时间（ISO 8601） */
    mtime: string
}

/** 卷分组：name 为空串表示未分卷（章节直接位于 Chapter/ 下） */
export interface PressVolumeGroup {
    /** 展示名：去掉序号前缀的卷名，未分卷为空串 */
    name: string
    /** 原始目录名（含序号前缀），作为稳定 key；未分卷为空串 */
    dirName: string
    chapters: PressChapterEntry[]
}

/** 作品详情：摘要与卷分组章节，一次请求返回详情页所需的全部数据 */
export interface PressProjectDetail {
    project: PressProjectSummary
    volumes: PressVolumeGroup[]
}

/** press/detail 请求：按作品目录取详情 */
export interface PressProjectDetailRequest {
    dirPath: string
}

/** press/workspace 请求：按作品目录读取设定、角色、大纲与 README 原文；dirPath 缺省时只返回作品列表 */
export interface PressWorkspaceRequest {
    dirPath?: string
}

/** 工作台文档原文：文件缺失时为空串，格式解析交给 Webview 的视图模型层 */
export interface PressWorkspaceFiles {
    readme: string
    setting: string
    characters: string
    outline: string
}

/** 工作台文档：一部作品的原始 Markdown 快照，name 取目录名 */
export interface PressWorkspaceDocument {
    dirPath: string
    name: string
    files: PressWorkspaceFiles
}

/** press/workspace 响应：未选择作品时 project 为 null，仍返回作品列表供初始页选择 */
export interface PressWorkspaceResult {
    project: PressWorkspaceDocument | null
    projects: PressProjectSummary[]
}

/** 判断是否为合法的工作台读取请求（类型收窄辅助）：dirPath 可缺省，缺省即只取列表 */
export function isPressWorkspaceRequest(payload: unknown): payload is PressWorkspaceRequest {
    if (payload === undefined) {
        return true
    }
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const dirPath = (payload as { dirPath?: unknown }).dirPath
    return dirPath === undefined || (typeof dirPath === 'string' && dirPath.length > 0)
}

/** press/createChapter 请求：在指定卷（缺省为最后一个卷）追加章节 */
export interface CreatePressChapterRequest {
    dirPath: string
    /** 落点卷目录名；缺省时落到序号最大的卷，作品还没有卷时落到默认卷1 */
    volumeDir?: string
}

/** press/createChapter 响应 */
export interface CreatedPressChapter {
    /** 相对存储根的章节路径 */
    path: string
    /** 章节展示标题 */
    title: string
    /** 落点卷名，空串表示未分卷（历史散章） */
    volume: string
}

/** press/createVolume 请求：新建一卷并写入其首章 */
export interface CreatePressVolumeRequest {
    dirPath: string
}

/** press/createVolume 响应 */
export interface CreatedPressVolume {
    /** 新卷目录名，含序号前缀 */
    volumeDir: string
    /** 卷展示名，如「卷3」 */
    volumeName: string
    /** 首章的相对路径 */
    chapterPath: string
    /** 首章展示标题 */
    chapterTitle: string
}

/** press/renameVolume 请求：只改卷目录的可读名，序号前缀由宿主保留 */
export interface RenamePressVolumeRequest {
    dirPath: string
    /** 当前卷目录名（含序号前缀） */
    volumeDir: string
    /** 新卷名，不含序号前缀 */
    name: string
}

/** press/renameVolume 响应 */
export interface RenamedPressVolume {
    /** 重命名后的卷目录名，含原序号前缀 */
    volumeDir: string
    /** 卷展示名 */
    volumeName: string
}

/** press/deleteVolume 请求：整卷移入回收站 */
export interface DeletePressVolumeRequest {
    dirPath: string
    /** 待删除的卷目录名（含序号前缀） */
    volumeDir: string
}

/** press/deleteProject 请求：整部作品（目录、文档与全部章节）移入回收站 */
export interface DeletePressProjectRequest {
    dirPath: string
}

/** press/deleteProject 响应：permanent 为 true 表示回收站不可用、已永久删除，前端提示不得再提「可恢复」 */
export interface DeletePressProjectResult {
    deleted: boolean
    permanent: boolean
}

/** 判断是否为删除作品的请求（类型收窄辅助）：dirPath 须为非空字符串，形态由服务侧再校验 */
export function isDeletePressProjectRequest(payload: unknown): payload is DeletePressProjectRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const dirPath = (payload as { dirPath?: unknown }).dirPath
    return typeof dirPath === 'string' && dirPath.length > 0
}

/** press/deleteChapter 请求：单章移入回收站 */
export interface DeletePressChapterRequest {
    dirPath: string
    /** 章节相对路径，须位于 press/{作品名}/Chapter/ 之下 */
    path: string
}

/** press/moveChapter 请求：把章节移动到另一卷末尾，序号按目标卷重排 */
export interface MovePressChapterRequest {
    dirPath: string
    /** 待移动章节的相对路径 */
    path: string
    /** 目标卷目录名（含序号前缀）；空串表示移到未分卷的 Chapter/ 根目录 */
    targetVolumeDir: string
}

/** press/moveChapter 响应：移动后的新路径与落点卷，供前端定位与展开 */
export interface MovedPressChapter {
    /** 移动后的相对路径，序号已按目标卷重排 */
    path: string
    /** 章节展示名（去序号前缀），用于提示 */
    title: string
    /** 落点卷展示名，空串表示未分卷 */
    volume: string
}

/** 判断是否为合法的重命名卷请求（类型收窄辅助） */
export function isRenamePressVolumeRequest(payload: unknown): payload is RenamePressVolumeRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { volumeDir?: unknown; name?: unknown }
    const isValidVolumeDir = typeof candidate.volumeDir === 'string' && candidate.volumeDir.length > 0
    const isValidName = typeof candidate.name === 'string' && candidate.name.trim().length > 0
    return isValidVolumeDir && isValidName
}

/** 判断是否为合法的删除卷请求（类型收窄辅助） */
export function isDeletePressVolumeRequest(payload: unknown): payload is DeletePressVolumeRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { volumeDir?: unknown }
    return typeof candidate.volumeDir === 'string' && candidate.volumeDir.length > 0
}

/** 判断是否为合法的删除章节请求（类型收窄辅助） */
export function isDeletePressChapterRequest(payload: unknown): payload is DeletePressChapterRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { path?: unknown }
    return typeof candidate.path === 'string' && candidate.path.length > 0
}

/** 判断是否为合法的移动章节请求（类型收窄辅助）：targetVolumeDir 允许空串，表示移入未分卷根目录 */
export function isMovePressChapterRequest(payload: unknown): payload is MovePressChapterRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { path?: unknown; targetVolumeDir?: unknown }
    const isValidPath = typeof candidate.path === 'string' && candidate.path.length > 0
    return isValidPath && typeof candidate.targetVolumeDir === 'string'
}

/** 判断是否为合法的新增章节请求（类型收窄辅助） */
export function isCreatePressChapterRequest(payload: unknown): payload is CreatePressChapterRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { volumeDir?: unknown }
    return (
        candidate.volumeDir === undefined || (typeof candidate.volumeDir === 'string' && candidate.volumeDir.length > 0)
    )
}

/** press/openChapter 请求：打开指定章节文档 */
export interface OpenPressChapterRequest {
    /** 相对存储根的章节路径，须已在索引库中登记 */
    path: string
}

/** 判断是否为合法的新建作品请求（类型收窄辅助） */
export function isCreatePressProjectRequest(payload: unknown): payload is CreatePressProjectRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { name?: unknown; audience?: unknown }
    const isValidName = typeof candidate.name === 'string' && candidate.name.trim().length > 0
    const isValidAudience = candidate.audience === undefined || typeof candidate.audience === 'string'
    return isValidName && isValidAudience
}

/** 判断是否为合法的作品目录入参（类型收窄辅助）：详情、新建章节等协议共用同一形状 */
export function isPressDirPath(payload: unknown): payload is { dirPath: string } {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { dirPath?: unknown }
    return typeof candidate.dirPath === 'string' && candidate.dirPath.length > 0
}

/** 判断是否为合法的打开章节请求（类型收窄辅助） */
export function isOpenPressChapterRequest(payload: unknown): payload is OpenPressChapterRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { path?: unknown }
    return typeof candidate.path === 'string' && candidate.path.length > 0
}

/** 读取目标读者：只接受枚举内的字符串，其余（含未传与空串）回落为默认值 */
export function readPressAudience(value: unknown): PressAudience {
    if (typeof value !== 'string') {
        return DEFAULT_PRESS_AUDIENCE
    }
    return PRESS_AUDIENCES.find((item) => item === value) ?? DEFAULT_PRESS_AUDIENCE
}

/** 人物外貌生成请求：人物卡字段与作品氛围的只读快照，供 pressAi/aiAppearance 使用 */
export interface CharacterAppearanceRequest {
    name: string
    /** 角色分类中文标签（主角 / 配角 / 反派 / 中立 / 龙套） */
    role: string
    /** 性别中文标签：男或女，必填 */
    gender: string
    age: string
    identity: string
    traits: string[]
    desire: string
    weakness: string
    ability: string
    /** 作品时代背景，空串表示未填写 */
    era: string
    genres: string[]
    tone: string
}

/** 人物外貌生成结果：单段白描纯文本，可直接写入外貌字段 */
export interface CharacterAppearanceResult {
    content: string
}

/** 画面风格：对齐番茄小说 AI 生图的风格分类，取值参与宿主提示词映射，新增值须同时在前端选项表与宿主 STYLE_HINTS 中登记 */
export type PortraitStyle = 'auto' | 'anime' | 'guofeng' | 'realistic' | 'cinematic' | 'photo' | 'pixel' | 'gameart'

/** 风格白名单：前端选项与宿主入参校验共用同一份，避免两处口径分叉 */
export const PORTRAIT_STYLES: readonly PortraitStyle[] = [
    'auto',
    'anime',
    'guofeng',
    'realistic',
    'cinematic',
    'photo',
    'pixel',
    'gameart',
]

/** 默认风格：智能匹配，由宿主按题材与世界观选择具体画风 */
export const DEFAULT_PORTRAIT_STYLE: PortraitStyle = 'auto'

/** 人物标识白名单：角色卡目录名只允许字母、数字、下划线与短横线，长度 4-64，避免路径穿越 */
const PRESS_CHARACTER_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/

/**
 * 判断人物标识能否用于角色卡目录：宿主校验与 Webview 文档解析共用同一口径，
 * 解析作品文档时必须先过这一关，否则含中文等字符的标识会在生成设定图时被宿主拒绝。
 */
export function isPressCharacterId(value: unknown): value is string {
    return typeof value === 'string' && PRESS_CHARACTER_ID_PATTERN.test(value)
}

/** 角色设定图：宿主生成并落盘后回传的图片信息 */
export interface CharacterPortrait {
    id: string
    /** 相对存储根的路径，形如 press/{作品名}/_portraits/{characterId}/{id}.png */
    path: string
    /** webview 可访问的完整 URL，仅本次会话有效（由宿主用 asWebviewUri 转换） */
    url: string
    createdAt: string
}

/** 角色设定图生成请求：人物卡与作品氛围的只读快照 */
export interface PortraitGenerateRequest {
    /** 作品目录（press/{作品名}）：角色卡落在该作品的 _portraits 下，删除作品即一并清理 */
    dirPath: string
    /** 人物 id，宿主据此建立图片目录，须为安全的短标识 */
    characterId: string
    name: string
    /** 角色分类中文标签（主角 / 配角 / 反派 / 中立 / 龙套） */
    role: string
    /** 性别中文标签：男或女，必填 */
    gender: string
    age: string
    identity: string
    appearance: string
    traits: string[]
    desire: string
    weakness: string
    ability: string
    era: string
    genres: string[]
    tone: string
    /** 画面风格：决定提示词里的画风描述 */
    style: PortraitStyle
}

/** 角色设定图生成结果 */
export interface PortraitGenerateResult {
    portrait: CharacterPortrait
}

/** 角色设定图删除请求：只接受 press/{作品名}/_portraits 下的相对路径 */
export interface PortraitDeleteRequest {
    path: string
}

/** 角色设定图列举请求：打开角色卡时按「作品目录 + 人物目录」回读已落盘的图片 */
export interface PortraitListRequest {
    /** 作品目录（press/{作品名}） */
    dirPath: string
    /** 人物 id，与作品目录共同定位角色卡目录 */
    characterId: string
}

/** 角色设定图列举结果：按生成时间降序，最新的排在前面 */
export interface PortraitListResult {
    portraits: CharacterPortrait[]
}

/** 角色设定图插入请求：把已落盘的图片插入当前编辑器光标处 */
export interface PortraitInsertRequest {
    path: string
}

/** 角色设定图插入结果：inserted 为 false 时由 reason 说明原因 */
export interface PortraitInsertResult {
    inserted: boolean
    /** no-editor：没有活动光标；unsaved：文档未保存；not-markdown：非 Markdown；failed：写入被拒绝 */
    reason?: 'no-editor' | 'unsaved' | 'not-markdown' | 'failed'
}

/** 角色设定图复制请求：把已落盘的图片写入系统剪贴板 */
export interface PortraitCopyRequest {
    path: string
}

/** 角色设定图复制结果：copied 为 false 时由 reason 说明原因 */
export interface PortraitCopyResult {
    copied: boolean
    /** unsupported：当前平台无法写入图片剪贴板；failed：写入过程失败 */
    reason?: 'unsupported' | 'failed'
}

/** 文本文件编码：导入前先探测，写入统一转为 UTF-8 且不带 BOM */
export type PressImportEncoding = 'utf-8' | 'utf-8-bom' | 'gb18030' | 'utf-16le'

/**
 * 导入失败原因码：前端按码分发提示文案，不解析宿主返回的字符串。
 * 取消不算失败，由 aborted 单列，前端静默处理。
 */
export type PressImportErrorCode =
    | 'aborted'
    | 'not-file'
    | 'bad-extension'
    | 'too-large'
    | 'empty'
    | 'binary'
    | 'bad-encoding'
    | 'no-chapter'
    | 'single-chapter'
    | 'bad-project-name'
    | 'project-exists'
    | 'write-failed'
    | 'partially-failed'
    | 'internal'

/**
 * press/import/pick 结果：用户取消时宿主返回 null。
 * 源文件绝对路径不下发前端，改为宿主签发的一次性 token，避免 Webview 伪造路径读取任意文件。
 */
export interface PressImportCandidate {
    /** 宿主签发的导入票据，press/import/start 原样回传，宿主据此取回源文件路径 */
    token: string
    /** 源文件名（含扩展名），仅用于展示 */
    fileName: string
    /** 建议作品名：已按作品名白名单清洗，用户可在确认弹窗内修改 */
    suggestedName: string
    /** 文件字节数 */
    byteSize: number
    /** 探测到的编码 */
    encoding: PressImportEncoding
    /** 识别到的章节数 */
    chapterCount: number
    /** 识别到的卷数：0 表示原文未分卷，章节平铺在 Chapter/ 下 */
    volumeCount: number
    /** 正文字符数（与索引库口径一致：去 Markdown 标记与空白） */
    charCount: number
    /** 首章标题，用于确认解析结果是否符合预期 */
    firstChapterTitle: string
    /** 末章标题 */
    lastChapterTitle: string
    /** 解析告警：前导内容丢弃、疑似重复章节等，逐条展示给用户 */
    warnings: string[]
}

/** press/import/start 请求：token 换源路径，作品名与目标读者由用户在确认弹窗内确定 */
export interface PressImportStartRequest {
    token: string
    name: string
    audience?: string
}

/** press/import/start 响应：任务立即返回，进度与终态经 press-import 通道广播 */
export interface PressImportStartResult {
    jobId: string
}

/** 导入任务状态：running 期间按节流推送，completed / failed / cancelled 为终态 */
export type PressImportStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** 导入进度与终态：载荷挂在 state 消息的 press-import 通道上 */
export interface PressImportProgress {
    jobId: string
    status: PressImportStatus
    /** 已处理章节数 */
    done: number
    /** 总章节数 */
    total: number
    /** 已写入的正文字符数 */
    writtenChars: number
    /** 写入失败的章节数，终态时用于提示部分失败 */
    failedChapters: number
    /** 终态时的作品目录，形如 press/{作品名} */
    dirPath: string
    /** 终态为 failed 时的原因码 */
    code?: PressImportErrorCode
    /** 面向用户的提示文案，running 期间为阶段描述 */
    message: string
}

/**
 * 语义归纳阶段：按依赖顺序推进，摘要先于卷纲与角色，卷纲与角色先于设定。
 * 每个阶段的产出都是独立文件，已存在即跳过，因此可以中断后逐阶段续跑。
 * 设定排在最后：它要引用章节摘要与卷纲，且是四个阶段里最不需要逐章重复计算的一步。
 */
export type PressSemanticStage = 'summary' | 'volumes' | 'characters' | 'setting'

/** 语义归纳失败原因码：前端按码分发文案 */
export type PressSemanticErrorCode =
    'aborted' | 'not-ready' | 'no-material' | 'no-chapters' | 'quota-exceeded' | 'internal'

/** 语义归纳进度与终态：载荷挂在 state 消息的 press-semantic 通道上 */
export interface PressSemanticProgress {
    jobId: string
    stage: PressSemanticStage
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    /** 已生成摘要的章节数（含此前已存在的） */
    done: number
    /** 章节总数 */
    total: number
    /** 本轮新生成的摘要数 */
    generated: number
    dirPath: string
    /** 终态失败或取消时的原因码，运行中缺省 */
    code?: PressSemanticErrorCode
    message: string
}

/** 判断是否为合法的导入启动请求（类型收窄辅助）：token 与作品名均须非空，目标读者可缺省 */
export function isPressImportStartRequest(payload: unknown): payload is PressImportStartRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { token?: unknown; name?: unknown; audience?: unknown }
    const isValidToken = typeof candidate.token === 'string' && candidate.token.length > 0
    const isValidName = typeof candidate.name === 'string' && candidate.name.trim().length > 0
    const isValidAudience = candidate.audience === undefined || typeof candidate.audience === 'string'
    return isValidToken && isValidName && isValidAudience
}

/** press/extract/characters 请求：从作品的导入素材中提取人物卡，素材由导入流程产出 */
export interface PressExtractCharactersRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
}

/** 判断是否为合法的提取人物卡请求（类型收窄辅助）：入参与作品目录请求同形 */
export function isPressExtractCharactersRequest(payload: unknown): payload is PressExtractCharactersRequest {
    return isPressDirPath(payload)
}

/**
 * 提取出的人物卡草案：字段保持模型输出的中文标签与纯文本，
 * 角色分类与性别的枚举归一由 Webview 承担，宿主不感知前端枚举。
 * 字段覆盖「基础面貌 / 身份出身 / 性格动机 / 背景经历 / 人物关系」五个维度，
 * 原文没有的依据一律留空——空字段可由作者补，错字段会污染整条设定链。
 */
export interface PressExtractedCharacter {
    name: string
    /** 别名、道号、绰号，原文未出现时为空串 */
    alias: string
    /** 角色分类中文标签：主角 / 配角 / 反派 / 中立 / 龙套，空串表示模型未判断 */
    role: string
    /** 性别中文标签：男 / 女 / 未知 */
    gender: string
    /** 年龄：原文给出的岁数或可直接判断的阶段，如「二十许」「约三十」 */
    age: string
    identity: string
    /** 外貌：体态、五官、衣着、标志性特征的白描，原文未描写时留空 */
    appearance: string
    /** 性格特征，已按顿号等分隔切成标签 */
    traits: string[]
    /** 背景故事：出身、关键经历与性格成因，原文未交代时留空 */
    background: string
    desire: string
    weakness: string
    /** 口头禅或标志性台词，原文未出现时留空 */
    catchphrase: string
    ability: string
    arc: string
    /** 与他人关系，按「角色名（关系）：说明」逐条书写，原文整段不切分 */
    relation: string
}

/** press/extract/characters 响应：characters 为空时 message 说明原因，前端可直接展示 */
export interface PressExtractCharactersResult {
    characters: PressExtractedCharacter[]
    message: string
}

/** press/analyze 请求：重新抽取作品的导入素材，只做本地统计、不调用模型，因此不占配额 */
export interface PressAnalyzeRequest {
    dirPath: string
}

/** 判断是否为合法的素材抽取请求（类型收窄辅助）：入参与作品目录请求同形 */
export function isPressAnalyzeRequest(payload: unknown): payload is PressAnalyzeRequest {
    return isPressDirPath(payload)
}

/** press/analyze 响应：素材抽取的统计结果，供界面说明「抽到了什么」 */
export interface PressAnalyzeResult {
    /** 扫描到的章节数 */
    chapterCount: number
    /** 识别到的人名候选数 */
    characterCount: number
    /** 命中金手指关键词的章数 */
    goldenFingerHits: number
    /** 命中世界构建关键词的章数：与金手指分开计数，设定提取两类素材都用 */
    settingClueCount: number
}

/** press/extract/outline 请求：用已落盘的导入素材重建大纲树 */
export interface PressExtractOutlineRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
}

/** 判断是否为合法的大纲提取请求（类型收窄辅助）：入参与作品目录请求同形 */
export function isPressExtractOutlineRequest(payload: unknown): payload is PressExtractOutlineRequest {
    return isPressDirPath(payload)
}

/** 提取出的章纲草案：字段保持素材原始口径，id、状态与节拍由 Webview 补齐 */
export interface PressExtractedChapter {
    /** 卷内序号，取自章节清单 */
    order: number
    title: string
    /** 计划梗概：来自章节摘要，素材未生成摘要时为空串 */
    summary: string
    /** 章末钩子中文标签：悬念 / 反转 / 情绪 / 无 */
    hook: string
    /** 张力 1-5 */
    tension: number
    /** 已写正文字数，取自章节清单 */
    wordCount: number
    /** 本章关键节点与转折，来自章节摘要，直接作为章纲节拍的初始内容 */
    beats: string[]
    /** 本章出场人物名，Webview 按名称匹配人物卡后回填 characterIds */
    characters: string[]
}

/** 提取出的卷纲草案：chapters 为空数组表示该卷在素材里没有章节 */
export interface PressExtractedVolume {
    name: string
    goal: string
    conflict: string
    /** 情节脉络：本卷主线推进的连贯描述，素材未生成卷纲时为空串 */
    plotline: string
    /** 关键转折：本卷的转折点，逐条列出 */
    turningPoints: string[]
    chapters: PressExtractedChapter[]
}

/** press/extract/outline 响应：volumes 为空时 message 说明原因，前端可直接展示 */
export interface PressExtractOutlineResult {
    volumes: PressExtractedVolume[]
    message: string
}

/** press/extract/setting 请求：从导入素材提取作品设定与金手指线索 */
export interface PressExtractSettingRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
}

/** 判断是否为合法的设定提取请求（类型收窄辅助）：入参与作品目录请求同形 */
export function isPressExtractSettingRequest(payload: unknown): payload is PressExtractSettingRequest {
    return isPressDirPath(payload)
}

/**
 * 提取出的设定草案：字段与作品设定的可提取项一一对应。
 * 关键约束：只提交模型给出的文本，枚举归一（读者、结局等）与合并冲突由 Webview 处理；
 * 世界观总述、地理与核心概念是「世界构建」的三根支柱，缺了它们后续续写只能靠章节片段猜设定。
 */
export interface PressExtractedSetting {
    logline: string
    conflict: string
    /** 世界观总述：世界形态、历史沿革、种族与文明结构 */
    worldview: string
    /** 主要地域、场景与空间格局 */
    geography: string
    era: string
    factions: string
    powerSystem: string
    /** 核心概念：作品独有的名词及其含义（灵气、序列、异火等） */
    concepts: string
    taboo: string
    goldenFingerType: string
    goldenFingerAbility: string
    goldenFingerCost: string
    perspective: string
    tone: string
    /** 题材标签，来自模型判断，前端与现有题材取并集 */
    genres: string[]
    /** 设定候选章线索：命中的章与关键词，仅供核对，不参与合并 */
    clues: string[]
}

/** press/extract/setting 响应：setting 为 null 时 message 说明原因，前端可直接展示 */
export interface PressExtractSettingResult {
    setting: PressExtractedSetting | null
    message: string
}

/** README Frontmatter 的可回填字段：其余字段（状态、创建时间）由宿主保留原值 */
export interface PressApplyMeta {
    title: string
    audience: string
    genres: string[]
    wordGoal: number
}

/**
 * press/apply 请求：把工作台草稿对应的段落回写进作品文档。
 * 字段是「段落片段」而不是整篇文档，落点与保留策略由宿主决定，避免覆盖用户手写内容。
 */
export interface PressApplyRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
    readme: PressApplyMeta
    /** 设定.md 中「提取设定」段落的正文 */
    setting: string
    /** 角色块：name 用作匹配键，text 是含「# 名称」标题行的完整块 */
    characters: { name: string; text: string }[]
    /** 大纲.md 中「分卷规划」段落的正文 */
    outline: string
}

/** 单份文档的写入上限：正常作品远低于该值，超出视为异常请求 */
const MAX_APPLY_FIELD_LENGTH = 2_000_000

/** 判断是否为合法的回写请求：逐字段校验类型与规模，角色块缺文本时整条拒绝 */
export function isPressApplyRequest(payload: unknown): payload is PressApplyRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as {
        readme?: unknown
        setting?: unknown
        characters?: unknown
        outline?: unknown
    }
    if (typeof candidate.setting !== 'string' || candidate.setting.length > MAX_APPLY_FIELD_LENGTH) {
        return false
    }
    if (typeof candidate.outline !== 'string' || candidate.outline.length > MAX_APPLY_FIELD_LENGTH) {
        return false
    }
    if (!Array.isArray(candidate.characters) || candidate.characters.length > 5000) {
        return false
    }
    const hasValidCharacters = candidate.characters.every((item: unknown) => {
        if (typeof item !== 'object' || item === null) {
            return false
        }
        const block = item as { name?: unknown; text?: unknown }
        return (
            typeof block.name === 'string' &&
            block.name.length > 0 &&
            typeof block.text === 'string' &&
            block.text.length <= MAX_APPLY_FIELD_LENGTH
        )
    })
    if (!hasValidCharacters) {
        return false
    }
    if (typeof candidate.readme !== 'object' || candidate.readme === null) {
        return false
    }
    const meta = candidate.readme as { title?: unknown; audience?: unknown; genres?: unknown; wordGoal?: unknown }
    return (
        typeof meta.title === 'string' &&
        typeof meta.audience === 'string' &&
        Array.isArray(meta.genres) &&
        meta.genres.every((genre: unknown) => typeof genre === 'string') &&
        typeof meta.wordGoal === 'number' &&
        Number.isFinite(meta.wordGoal) &&
        meta.wordGoal >= 0
    )
}

/** press/apply 响应：written 为实际写入的文件名，便于前端提示写了哪些文档 */
export interface PressApplyResult {
    written: string[]
}

/** press/semantic/run 请求：只跑指定阶段的 AI 归纳，缺省按摘要 → 卷纲 → 角色卡全部执行 */
export interface PressSemanticRunRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
    stages?: PressSemanticStage[]
}

/** 判断是否为合法的阶段性归纳请求：阶段取值必须在白名单内，重复项交由服务按传入顺序执行 */
export function isPressSemanticRunRequest(payload: unknown): payload is PressSemanticRunRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { stages?: unknown }
    if (candidate.stages === undefined) {
        return true
    }
    if (!Array.isArray(candidate.stages) || candidate.stages.length === 0) {
        return false
    }
    return candidate.stages.every(
        (stage: unknown) =>
            stage === 'summary' || stage === 'volumes' || stage === 'characters' || stage === 'setting',
    )
}

/** press/semantic/run 响应：jobId 用于匹配后续 press-semantic 进度与取消 */
export interface PressSemanticRunResult {
    jobId: string
}

/** press/semantic/cancel 请求：取消指定归纳任务，在批次边界生效 */
export interface PressSemanticCancelRequest {
    jobId: string
}

/** 判断是否为合法的取消请求：jobId 须为非空字符串 */
export function isPressSemanticCancelRequest(payload: unknown): payload is PressSemanticCancelRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { jobId?: unknown }
    return typeof candidate.jobId === 'string' && candidate.jobId.length > 0
}
