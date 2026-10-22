/**
 * 作品契约：仪表盘 /press 页的作品摘要、创建、打开、卷重命名/删除与章节删除/移动的请求结构，
 * 目标读者枚举，以及人物外貌生成（pressAi/aiAppearance）与角色设定图（pressAi/generatePortrait、listPortraits、deletePortrait）的契约。
 * 使用方：仪表盘 Webview 的作品列表与宿主侧 DashboardViewProvider、modules/press 服务；
 * 外貌与角色卡契约同时被写作管理页的人物弹窗、宿主 PressAiService 与 PortraitService 使用。
 * 复用约定：dirPath 取相对存储根口径（press/{作品名}），与索引库 files.path 同源；作品名即目录名。
 * 关键约束：前端传入的作品名与目录路径均不可信，宿主须先经名称白名单校验或索引库回查后才可触达文件系统；
 * 目标读者枚举只此一份，前端选项与落盘 Frontmatter 共用，避免两处口径分叉；
 * 外貌生成入参同样不可信，宿主须重新裁剪长度后才会进入提示词。
 */

/** 目标读者：写入 README Frontmatter 的 audience，同时作为添加作品时的唯一选项来源 */
export const PRESS_AUDIENCES = ['男频', '女频'] as const

/** 目标读者取值 */
export type PressAudience = (typeof PRESS_AUDIENCES)[number]

/** 未指定目标读者时的默认值 */
export const DEFAULT_PRESS_AUDIENCE: PressAudience = '男频'

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

/** 角色设定图：宿主生成并落盘后回传的图片信息 */
export interface CharacterPortrait {
    id: string
    /** 相对存储根的路径，形如 press/_portraits/{characterId}/{id}.png */
    path: string
    /** webview 可访问的完整 URL，仅本次会话有效（由宿主用 asWebviewUri 转换） */
    url: string
    createdAt: string
}

/** 角色设定图生成请求：人物卡与作品氛围的只读快照 */
export interface PortraitGenerateRequest {
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

/** 角色设定图删除请求：只接受 press/_portraits 下的相对路径 */
export interface PortraitDeleteRequest {
    path: string
}

/** 角色设定图列举请求：打开角色卡时按人物目录回读已落盘的图片 */
export interface PortraitListRequest {
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
