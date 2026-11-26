/**
 * 作品契约：作品摘要、导入、设定 / 大纲 / 人物提取、AI 生成与角色卡列举的请求 / 结果结构。
 * 复用约定：dirPath 取相对存储根口径（press/{作品名}），与索引库 files.path 同源；提取草案按维度铺字段。
 * 关键约束：作品名与路径不可信，宿主须白名单校验或索引回查；导入源文件只回传宿主签发的 token；
 * 模型输出只作草案，宿主须收窄长度与白名单（含线索 id），由 Webview 决定合并策略后再落盘。
 */

/** 目标读者：写入 README 正文「作品设定」段，同时作为添加作品时的唯一选项来源 */
export const PRESS_AUDIENCES = ['男频', '女频'] as const

/** 目标读者取值 */
export type PressAudience = (typeof PRESS_AUDIENCES)[number]

/** 未指定目标读者时的默认值 */
export const DEFAULT_PRESS_AUDIENCE: PressAudience = '男频'

/**
 * 作品内的素材目录名：章节清单与摘录、人名候选，以及 AI 初稿（摘要 / 卷纲 / 角色卡 / 设定）都平铺在这里。
 * 关键约束：不属于作品内容，索引与字数统计必须排除，否则作品字数会虚高；
 * 目录名按「素材库」命名，不沿用表示一次性导入动作的旧名。
 */
export const PRESS_IMPORT_DIR = 'Materials'

/**
 * 旧版素材目录名：早期版本用 `_import`。读取素材时须回退兼容，写入前须整体迁移到 PRESS_IMPORT_DIR；
 * 索引排除同时保留它，迁移失败的旧目录同样不能污染字数统计。
 */
export const LEGACY_PRESS_IMPORT_DIR = '_import'

/**
 * 作品快照目录名：位于 `press/{作品名}/` 下，每个子目录是一版完整的设定、角色、大纲与 README 副本。
 * 关键约束：与素材目录一样必须排除出索引——快照内的 Markdown 是历史副本而非作品正文，计入会让字数虚高。
 */
export const PRESS_SNAPSHOT_DIR = 'Snapshots'

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
    /** 已选定封面的 webview 可用 URL：未设封面或文件已被删除时不返回 */
    coverUrl?: string
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

/**
 * 工作台可直接打开的文档键：设定各分组、人物页与大纲页的「打开文档」都按它定位文件。
 * 前端只传这个键，文件名映射留在宿主侧，避免把可变的文档名暴露成可伪造的路径。
 */
export type PressDocKey = 'readme' | 'world' | 'power' | 'faction' | 'place' | 'item' | 'characters' | 'outline'

/** 可打开文档的白名单：前端按钮与宿主入参校验共用同一份 */
export const PRESS_DOC_KEYS: readonly PressDocKey[] = [
    'readme',
    'world',
    'power',
    'faction',
    'place',
    'item',
    'characters',
    'outline',
]

/** press/openDoc 请求：打开作品目录下的某份文档 */
export interface PressOpenDocRequest {
    /** 相对存储根的作品目录，须已在索引库中存在 */
    dirPath: string
    /** 目标文档键：命中宿主侧的文件名映射表 */
    doc: PressDocKey
}

/**
 * press/openDoc 响应：created 表示该文档原本不存在、本次按最小骨架补建后打开。
 * 旧作品的骨架只有 设定.md 等主文档，分组文档缺失属正常情况，不视为错误。
 */
export interface PressOpenDocResult {
    opened: boolean
    created: boolean
}

/** 章节条目：Chapters/ 下的一个 Markdown 文档 */
export interface PressChapterEntry {
    /** 相对存储根路径，形如 press/剑来/Chapters/01-初见.md */
    path: string
    /** 展示标题：直接取正文一级标题，缺失时用去序号前缀的文件名 */
    title: string
    /** 文档字数，取自索引库 */
    wordCount: number
    /** 文档最近修改时间（ISO 8601） */
    mtime: string
}

/** 卷分组：name 为空串表示未分卷（章节直接位于 Chapters/ 下） */
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

/** 资料条目分类：设定页条目分段与设定图文件名前缀共用同一份取值 */
export type PressLoreKind = 'faction' | 'place' | 'item'

/** 条目分类白名单：前端分段、宿主入参校验与提示词表共用同一份，避免三处口径分叉 */
export const PRESS_LORE_KINDS: readonly PressLoreKind[] = ['faction', 'place', 'item']

/** 条目分类收窄：命名字段来自磁盘与索引行，非法值一律判否，不做默认归类 */
export function isPressLoreKind(value: unknown): value is PressLoreKind {
    return PRESS_LORE_KINDS.some((item) => item === value)
}

/**
 * 设定页分组文档原文：设定按标签页各成一篇，世界观、金手指与三类资料条目分别落在自己的文档里。
 * 与四份主文档分开读取——它们只服务设定页，不参与快照，文件缺失时为空串。
 */
export interface PressSettingSectionFiles {
    /** 世界观.md 原文 */
    world: string
    /** 金手指.md 原文 */
    power: string
    /** 势力.md 原文：条目文档，按条目块合并，不做整段替换 */
    faction: string
    /** 地点.md 原文：条目文档，按条目块合并 */
    place: string
    /** 物品.md 原文：条目文档，按条目块合并 */
    item: string
}

/** 工作台文档：一部作品的原始 Markdown 快照，name 取目录名 */
export interface PressWorkspaceDocument {
    dirPath: string
    name: string
    files: PressWorkspaceFiles
    /** 设定页分组文档：按标签页拆分，与四份主文档分开读取 */
    settingSections: PressSettingSectionFiles
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
    /** 落点卷目录名；缺省时落到序号最大的卷，作品还没有卷时落到自动创建的默认卷 */
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
    /** 由该作品归入通用对话的历史会话条数：前端在删除提示里追加一句，0 表示没有可归入的会话 */
    adoptedConversations: number
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
    /** 章节相对路径，须位于 press/{作品名}/Chapters/ 之下 */
    path: string
}

/** press/moveChapter 请求：把章节移动到另一卷末尾，序号按目标卷重排 */
export interface MovePressChapterRequest {
    dirPath: string
    /** 待移动章节的相对路径 */
    path: string
    /** 目标卷目录名（含序号前缀）；空串表示移到未分卷的 Chapters/ 根目录 */
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

/** 判断是否为合法的打开作品文档请求（类型收窄辅助）：文档键必须在白名单内 */
export function isPressOpenDocRequest(payload: unknown): payload is PressOpenDocRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { dirPath?: unknown; doc?: unknown }
    const hasDirPath = typeof candidate.dirPath === 'string' && candidate.dirPath.length > 0
    return hasDirPath && PRESS_DOC_KEYS.some((key) => key === candidate.doc)
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
    /** 外貌标签：可观察的短标签，生成时逐条落实，优先级高于已有描写 */
    appearanceTags: string[]
    /** 已写外貌：只作语气与细节补充，与标签冲突时以标签为准 */
    appearance: string
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

/**
 * 设定页可交给 AI 生成的字段：作品名、故事内核各项，以及世界观与金手指里可展开的描述类字段。
 * 金手指类型不在其中——它是短词枚举，也是其余字段生成的输入约束，不交给模型改写。
 */
export type SettingFieldKey =
    | 'title'
    | 'summary'
    | 'logline'
    | 'opening'
    | 'conflict'
    | 'theme'
    | 'arc'
    | 'worldview'
    | 'geography'
    | 'era'
    | 'factions'
    | 'powerSystem'
    | 'concepts'
    | 'taboo'
    | 'goldenFingerAbility'
    | 'goldenFingerCost'
    | 'goldenFingerLimit'
    | 'goldenFingerUpgrade'

/** 设定字段白名单：前端按钮、宿主入参校验与提示词表共用同一份，避免三处口径分叉 */
export const SETTING_FIELD_KEYS: readonly SettingFieldKey[] = [
    'title',
    'summary',
    'logline',
    'opening',
    'conflict',
    'theme',
    'arc',
    'worldview',
    'geography',
    'era',
    'factions',
    'powerSystem',
    'concepts',
    'taboo',
    'goldenFingerAbility',
    'goldenFingerCost',
    'goldenFingerLimit',
    'goldenFingerUpgrade',
]

/**
 * 设定快照：整份设定的只读副本，设定字段与条目描述两类生成共用同一份字段口径。
 * 空串表示作者尚未填写，由宿主决定是否作为约束。
 */
export interface SettingSnapshot {
    title: string
    penName: string
    /** 目标读者中文标签：男频或女频 */
    audience: string
    genres: string[]
    period: string
    place: string
    era: string
    tone: string
    ending: string
    perspective: string
    narrative: string
    references: string
    summary: string
    logline: string
    opening: string
    conflict: string
    /** 主题：故事要探讨的核心命题 */
    theme: string
    /** 主角弧光：从什么到什么 */
    arc: string
    worldview: string
    geography: string
    factions: string
    powerSystem: string
    concepts: string
    taboo: string
    goldenFingerType: string
    goldenFingerAbility: string
    /** 代价：使用金手指要付出的东西 */
    goldenFingerCost: string
    /** 限制：适用范围的边界与不可逾越的硬约束 */
    goldenFingerLimit: string
    /** 升级体系：金手指自身的成长阶段与解锁条件 */
    goldenFingerUpgrade: string
    extra: string
}

/** 设定字段生成请求：目标字段 + 已填设定的只读快照，供 pressAi/aiSettingField 使用 */
export interface SettingFieldGenerateRequest extends SettingSnapshot {
    /** 目标字段：其当前值也在快照的同名字段里，非空时要求在其基础上完善 */
    field: SettingFieldKey
}

/** 设定字段生成结果：单段纯文本，可直接写入目标字段 */
export interface SettingFieldGenerateResult {
    content: string
}

/**
 * 条目描述生成请求：条目身份与草稿 + 整份设定快照，供 pressAi/aiLoreDescription 使用。
 * 名称必填——它既是生成的核心事实，也是文档里的二级标题。
 */
export interface LoreDescriptionGenerateRequest extends SettingSnapshot {
    kind: PressLoreKind
    name: string
    /** 已有描述草稿：非空时要求在此基础上完善，不另起一稿 */
    description: string
    /** 同分类其它条目名：作为既有设定，避免生成同义重复的条目 */
    siblings: string[]
    /** 关联人物姓名：仅势力有值，地点与物品为空表 */
    members: string[]
}

/** 条目描述生成结果：单段纯文本，可直接写入条目描述 */
export interface LoreDescriptionGenerateResult {
    content: string
}

/** 生成请求里的结构阶段：全书转折约束，只传文案不传 id，模型不回写结构纲 */
export interface OutlineActContext {
    name: string
    /** 转折类型中文标签（未指定 / 激励事件 / 中点 / 低谷 / 高潮 / 结局） */
    kind: string
    /** 卷位：null 表示未定，非 null 时作为分卷锚点 */
    volumeOrder: number | null
    /** 叙事作用：该转折在全书叙事里承担的功能 */
    narrativeRole: string
    event: string
    /** 这一转折让主角走到弧光的哪一步 */
    protagonistChange: string
}

/** 生成请求里的线索摘要：id 用于草案回指，章节引用写「卷序-章序」，未定为空串 */
export interface OutlineClueContext {
    id: string
    name: string
    plant: string
    payoff: string
    note: string
}

/**
 * 按卷生成章纲的请求：卷纲 + 结构纲 + 本卷相关伏笔 + 作品设定快照 + 卷内现状。
 * 关键约束：产出「阶段 / 标题 / 计划梗概 / 节拍 / 线索关联」，线索 id 必须来自 clues 白名单；
 * POV 与出场人物仍留给作者细化，结构阶段只作转折约束、不自动写回阶段划分。
 */
export interface VolumeChaptersGenerateRequest {
    /** 本卷卷名，含「第N卷」前缀 */
    volumeName: string
    /** 核心事件：本卷主线，作者写在卷纲卡里的一段描述 */
    coreEvent: string
    /** 主要情节：作者按发生顺序写的条目 */
    mainPlot: string[]
    turningPoints: string[]
    /** 卷末结果 */
    result: string
    /** 全书结构阶段：约束转折走向 */
    acts: OutlineActContext[]
    /** 本卷相关线索：埋设章或回收章落在本卷才传入 */
    clues: OutlineClueContext[]
    /** 起始章序：生成结果从这里连续编号 */
    startOrder: number
    /** 期望章数：0 表示按卷纲自行推断 */
    chapterCount: number
    /** 卷内已有章数：用于避免与既有章重复 */
    existingCount: number
    /** 作品设定快照 */
    setting: SettingSnapshot
    /** 可出场人物名：用于把剧情落到具体角色上 */
    characters: string[]
}

/**
 * 按作品设定生成卷纲的请求：结构纲 + 设定快照 + 人物名单 + 现有卷名。
 * 关键约束：volumeCount 为 0 时由模型按故事规模自行建议卷数，结构阶段只约束转折归属；
 * 生成结果只覆盖卷纲字段，不触碰任何已写章节。
 */
export interface VolumeOutlinesGenerateRequest {
    /** 期望卷数：0 表示由模型自行建议 */
    volumeCount: number
    /** 已有卷名：避免生成重复的卷 */
    existingNames: string[]
    /** 全书结构阶段：约束分卷边界与卷末转折 */
    acts: OutlineActContext[]
    setting: SettingSnapshot
    characters: string[]
}

/** 生成的单卷卷纲草案：卷名、预计章节数与卷纲五项 */
export interface VolumeOutlineDraft {
    /** 卷名：含「第N卷」前缀 */
    name: string
    /** 预计章节数：0 表示未定 */
    expectedChapters: number
    coreEvent: string
    mainPlot: string[]
    turningPoints: string[]
    result: string
}

/** 生成卷纲的结果：volumes 为空表示模型没给出可用条目，由前端提示重试 */
export interface VolumeOutlinesGenerateResult {
    volumes: VolumeOutlineDraft[]
}

/** 卷纲单字段：只有这两项由 AI 单独补写，其余字段（名、章数、情节、转折）由作者自己定 */
export type VolumeFieldKey = 'coreEvent' | 'result'

/**
 * 卷纲单字段生成请求：把这一卷的现状整段交给模型，只产出请求的那一项。
 * 关键约束：字段只能是 coreEvent / result；其余字段作为上下文，模型不得改写。
 */
export interface VolumeFieldGenerateRequest {
    field: VolumeFieldKey
    volumeName: string
    coreEvent: string
    mainPlot: string[]
    turningPoints: string[]
    result: string
    setting: SettingSnapshot
    characters: string[]
}

/** 卷纲单字段生成结果：纯文本，直接写回输入框 */
export interface VolumeFieldGenerateResult {
    content: string
}

/**
 * 章纲计划梗概生成请求：本章章纲卡 + 本卷卷纲 + 全书结构 + 设定快照 + 出场人物与前后章线索。
 * 关键约束：summary 是「打算写」而非正文事实，actualSummary 不进请求；已有梗概非空时要求在原文上完善；
 * 阶段 / 钩子 / 节奏只作写作约束，模型不得回写这些字段。
 */
export interface ChapterSummaryGenerateRequest {
    /** 本章标题：不含「第N章」前缀 */
    chapterTitle: string
    /** 本卷卷名：含「第N卷」前缀 */
    volumeName: string
    stage: string
    pov: string
    goal: string
    obstacle: string
    turn: string
    result: string
    emotion: string
    /** 章末钩子的中文标签 */
    hook: string
    /** 本章节奏的中文标签 */
    pacing: string
    /** 计划梗概当前值，非空时在其基础上完善 */
    summary: string
    /** 节拍文本：本章细纲，按落笔顺序 */
    beats: string[]
    /** 场景纲一句概括：按场景顺序 */
    scenes: string[]
    /** 出场人物姓名：从人物卡映射，不传 id */
    characters: string[]
    /** 本卷核心事件 */
    coreEvent: string
    /** 本卷主要情节 */
    mainPlot: string[]
    /** 全书结构阶段：约束转折语义 */
    acts: OutlineActContext[]
    /** 本章相关伏笔：按埋设 / 回收章引用筛选 */
    clues: OutlineClueContext[]
    /** 上一章计划梗概：无上一章时为空串 */
    prevSummary: string
    setting: SettingSnapshot
}

/** 章纲计划梗概生成结果：单段纯文本，直接写回梗概输入框 */
export interface ChapterSummaryGenerateResult {
    content: string
}

/** 草案里的线索关联：id 来自请求的 clues，action 指定本章埋设或回收 */
export interface VolumeChapterClueRef {
    id: string
    action: 'plant' | 'payoff'
}

/** 生成的单章草案：阶段、标题、计划梗概、章节细纲与线索关联 */
export interface VolumeChapterDraft {
    /** 阶段名：如「第一阶段：坠楼与觉醒」，空串表示未分组 */
    stage: string
    /** 章标题：不含「第N章」前缀 */
    title: string
    /** 章节介绍：写入计划梗概 */
    summary: string
    /** 章节细纲：3~6 条节拍，生成后直接写入节拍列表 */
    beats: string[]
    /** 本章承担的线索动作：写入时按实际章序更新线索表，不写进章纲字段 */
    clueRefs: VolumeChapterClueRef[]
}

/** 按卷生成章纲的结果：chapters 为空表示模型没给出可用条目，由前端提示补卷纲或重试 */
export interface VolumeChaptersGenerateResult {
    chapters: VolumeChapterDraft[]
}

/**
 * 伏笔位置识别请求：只传作品目录与伏笔白名单，正文摘录由宿主从章节文件读取。
 * 关键约束：伏笔 id 必须来自当前大纲，宿主按白名单校验模型输出；不传正文全文以免前端与提示词冗余。
 */
export interface ClueRefsAnalyzeRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
    /** 待识别伏笔：只给 id、名称与备注，不传已有埋设/回收引用 */
    clues: { id: string; name: string; note: string }[]
}

/** 识别用章节摘录：坐标用章纲 order，与伏笔引用的「卷序-章序」一致 */
export interface ClueRefsAnalyzeChapter {
    volumeOrder: number
    chapterOrder: number
    title: string
    excerpt: string
}

/** 宿主交给 AI 的识别输入：伏笔白名单 + 章节摘录 */
export interface ClueRefsAnalyzeInput {
    clues: ClueRefsAnalyzeRequest['clues']
    chapters: ClueRefsAnalyzeChapter[]
}

/** 识别出的伏笔位置建议：id 来自白名单，坐标来自请求内的章节清单 */
export interface ClueRefSuggestion {
    id: string
    action: 'plant' | 'payoff'
    volumeOrder: number
    chapterOrder: number
}

/** 伏笔位置识别结果：refs 为空表示没找到可信位置，前端按空结果提示 */
export interface ClueRefsAnalyzeResult {
    refs: ClueRefSuggestion[]
}

/** 成长线轨道：主角自身境界 / 战力，或金手指等级 */
export type PressGrowthTrack = 'protagonist' | 'goldenFinger'

/** 当前成长表里的一条已有节点：只传轨道与值，让模型跳过已记录的变化 */
export interface GrowthAnalyzePoint {
    track: string
    value: string
}

/**
 * 成长线识别请求：只传作品目录与当前成长表，章节摘录由宿主从章节文件读取。
 * 关键约束：轨道与值只用于去重参考，模型输出仍须按卷章坐标与轨道白名单校验。
 */
export interface GrowthAnalyzeRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
    points: GrowthAnalyzePoint[]
}

/** 宿主交给 AI 的成长线识别输入：当前成长表 + 章节摘录 */
export interface GrowthAnalyzeInput {
    points: GrowthAnalyzePoint[]
    chapters: ClueRefsAnalyzeChapter[]
}

/** 识别出的成长节点建议：坐标必须落在现有卷章内，值为自由文本 */
export interface GrowthPointSuggestion {
    volumeOrder: number
    chapterOrder: number
    track: PressGrowthTrack
    value: string
    note: string
}

/** 成长线识别结果：points 为空表示没识别到明确变化，前端按空结果提示 */
export interface GrowthAnalyzeResult {
    points: GrowthPointSuggestion[]
}

/**
 * 画面风格相关定义已下沉到 ./imageStyle：出图参数与媒体模块不再需要通过 press 契约取用，
 * 此处保留转发仅为兼容既有 @shared/types/press 引用，新增代码请直接从 ./imageStyle 取。
 */
export { DEFAULT_PORTRAIT_STYLE, isPortraitStyle, PORTRAIT_STYLES, type PortraitStyle } from './imageStyle'

/** 人物标识白名单：8 位随机数字，同时作为设定图文件名里的角色段，天然不含路径分隔符 */
const PRESS_CHARACTER_ID_PATTERN = /^\d{8}$/

/**
 * 判断人物标识能否用于角色卡目录与文件名：宿主校验与 Webview 文档解析共用同一口径，
 * 解析作品文档时必须先过这一关，否则非法标识会在生成设定图时被宿主拒绝。
 */
export function isPressCharacterId(value: unknown): value is string {
    return typeof value === 'string' && PRESS_CHARACTER_ID_PATTERN.test(value)
}

/**
 * 纯布尔判断：给已经确定是字符串的场景使用。
 * 类型谓词在「已收窄为 string」的变量上取否定分支会把类型推成 never，这类场景要避开守卫。
 */
export function matchesCharacterId(value: string): boolean {
    return PRESS_CHARACTER_ID_PATTERN.test(value)
}

/**
 * 判断资料条目标识能否用于条目块与设定图出处：与人物标识同规范（8 位数字）。
 * 编号空间与人物标识互不干扰，归属由媒体索引的 lore_kind / lore_id 承载，不再靠文件名前缀区分。
 */
export function isPressLoreId(value: unknown): value is string {
    return typeof value === 'string' && PRESS_CHARACTER_ID_PATTERN.test(value)
}

/** 角色设定图：宿主生成并落盘后回传的图片信息 */
export interface CharacterPortrait {
    id: string
    /** 相对存储根的路径，形如 images/{YYYYMM}/{媒体 id}.png */
    path: string
    /** webview 可访问的完整 URL，仅本次会话有效（由宿主用 asWebviewUri 转换） */
    url: string
    createdAt: string
}

/** 角色设定图列举结果：按生成时间降序，最新的排在前面 */
export interface PortraitListResult {
    portraits: CharacterPortrait[]
}

/**
 * 画廊项：列表卡片只需要「哪张图、能显示」，不带相对路径与生成时间，
 * 避免几十个角色一次列举时把无关字段全塞进 webview。
 */
export interface PortraitGalleryItem {
    id: string
    url: string
}

/**
 * 作品全部角色的设定图画廊：键为人物 id，值为该角色目录下的图片（最新在前）。
 * 列表页一次请求即可让所有卡片显示封面，不必为每个人物单独发起列举。
 */
export interface PortraitGalleryResult {
    galleries: Record<string, PortraitGalleryItem[]>
}

/** 作品封面：图库中当前选中（或最新）的普通图片 */
export interface PressCover {
    id: string
    /** 相对存储根的路径，形如 images/{YYYYMM}/{媒体 id}.png */
    path: string
    /** webview 可访问的完整 URL，仅本次会话有效（由宿主用 asWebviewUri 转换） */
    url: string
    createdAt: string
}

/** 封面列举结果：按生成时间降序，最新的排在前面；selectedId 为当前选中的封面 */
export interface CoverListResult {
    /** 候选封面：已按修改时间降序截断到上限 */
    covers: PressCover[]
    selectedId: string | null
    /** 命中总数：可能大于 covers.length，界面据此提示「仅显示最新 N 张」 */
    total: number
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
    /** 识别到的卷数：0 表示原文未分卷，章节平铺在 Chapters/ 下 */
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
    /** 身高：原文写明的身形数据或可直接判断的高矮，如「一米七八」，原文未写时留空 */
    height: string
    /** 体型中文标签：娇小 / 清瘦 / 纤细 / 修长 / 匀称 / 健壮 / 魁梧 / 圆润 / 丰腴 / 肥胖，未判断时留空 */
    bodyType: string
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

/** press/mergeChapterSummary 请求：把素材里的章节摘要回填到大纲「计划梗概」 */
export interface MergeChapterSummaryRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
}

/** 判断是否为合法的摘要回填请求（类型收窄辅助）：入参与作品目录请求同形 */
export function isMergeChapterSummaryRequest(payload: unknown): payload is MergeChapterSummaryRequest {
    return isPressDirPath(payload)
}

/** press/mergeChapterSummary 响应：逐章回填的统计，供界面说明「改了什么」 */
export interface MergeChapterSummaryResult {
    /** 成功写入摘要的章节数 */
    updated: number
    /** 有摘要但被跳过的章节数：已有梗概、章号对不上或大纲正在编辑 */
    skipped: number
    /** 读写失败的章节数：单章失败不影响其余章节 */
    failed: number
    /** 面向用户的一句话结论 */
    message: string
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

/** 提取出的卷纲草案：字段与大纲卷纲一一对应，chapters 为空数组表示该卷在素材里没有章节 */
export interface PressExtractedVolume {
    name: string
    /** 核心事件：素材里的卷目标与卷冲突合并成一段 */
    coreEvent: string
    /** 主要情节：素材里的情节脉络按分号拆成条目 */
    mainPlot: string[]
    /** 关键转折：本卷的转折点，逐条列出 */
    turningPoints: string[]
    chapters: PressExtractedChapter[]
}

/** press/extract/outline 响应：volumes 为空时 message 说明原因，前端可直接展示 */
export interface PressExtractOutlineResult {
    volumes: PressExtractedVolume[]
    message: string
}

/**
 * 章节事实：写后回填的只读输入，来自大纲章块的计划梗概与索引库的字数。
 * 关键约束：只读，不回写任何文件；梗概取自大纲，字数取自索引库。
 */
export interface PressChapterFact {
    /** 相对存储根的章节路径 */
    path: string
    /** 卷目录名（含序号前缀），未分卷为空串 */
    volumeDir: string
    /** 卷序：取自卷目录的序号前缀，与大纲卷名的「第N卷」一致 */
    volumeOrder: number
    /** 卷内位置（1 基） */
    chapterIndex: number
    /** 章节标题：取索引库口径 */
    title: string
    /** 本章介绍（实际摘要） */
    summary: string
    wordCount: number
    mtime: string
}

/** press/outline/facts 请求：读某作品全部章节的写后事实 */
export interface PressOutlineFactsRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
}

/** 判断是否为合法的章节事实请求（类型收窄辅助）：入参与作品目录请求同形 */
export function isPressOutlineFactsRequest(payload: unknown): payload is PressOutlineFactsRequest {
    return isPressDirPath(payload)
}

/** press/outline/facts 响应：按卷章顺序返回，供写后回填逐章对比 */
export interface PressOutlineFactsResult {
    chapters: PressChapterFact[]
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
    /** 代价：使用金手指要付出的东西 */
    goldenFingerCost: string
    /** 限制：适用范围的边界与不可逾越的硬约束 */
    goldenFingerLimit: string
    /** 升级体系：金手指自身的成长阶段与解锁条件 */
    goldenFingerUpgrade: string
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

/** README 正文中可回填的元信息字段：由宿主写进一级标题与「作品设定」段 */
export interface PressApplyMeta {
    title: string
    audience: string
    genres: string[]
    wordGoal: number
}

/**
 * press/apply 请求：把工作台草稿对应的段落回写进作品文档。
 * 字段是「段落片段」而不是整篇文档，落点与保留策略由宿主决定，避免覆盖用户手写内容。
 * 设定按标签页拆分：基本信息写 README，世界观与金手指各写自己的文档；其余字段按需携带。
 * 除 dirPath 外全部可选：手动保存只会带上当前标签页对应的那一份，未带的文件保持原样。
 */

/** 回写块：name 是宿主侧的匹配键，text 为含标题行的完整块，写入时整块替换同名块 */
export interface PressApplyBlock {
    /** 匹配键：角色与资料条目都取块标题名（角色新格式二级、旧文件一级，条目恒为二级） */
    name: string
    /** 含标题行的完整块，写入时整块替换同名块 */
    text: string
}

/**
 * 大纲段落键：与前端 OutlineSectionKey 一一对应，也是宿主 writer 的落点表索引。
 * 关键约束：键名一变，回写就会落到不存在的段落上，前端序列化与宿主落点表必须同步修改；
 * 卷纲与章节内容分开成两段——卷纲改一次只重写卷纲，章节改一次只重写章节；
 * 「设定纲」「节奏情绪」「时间线」不再回写——设定归作品设定、节奏类型进章纲、时间线段落原地保留；
 * 成长线是独立段落，与结构纲 / 伏笔线索互不覆盖。
 */
export type PressOutlineSectionKey = 'structure' | 'volumeOutlines' | 'chapters' | 'clues' | 'growth'

/** 大纲段落白名单：校验与遍历共用同一份，不接受任意字符串 */
export const PRESS_OUTLINE_SECTION_KEYS: readonly PressOutlineSectionKey[] = [
    'structure',
    'volumeOutlines',
    'chapters',
    'clues',
    'growth',
]

/**
 * press/apply 请求：把工作台草稿对应的段落回写进作品文档。
 * 字段是「段落片段」而不是整篇文档，落点与保留策略由宿主决定，避免覆盖用户手写内容。
 * 设定按标签页拆分：基本信息写 README，世界观与金手指各写自己的文档，资料条目各写自己的文档。
 * 大纲按功能模块拆段：每个二级段落一段，只写变动的那几段；
 * 除 dirPath 外全部可选：手动保存只会带上当前操作对应的那一份，未带的文件保持原样。
 */
export interface PressApplyRequest {
    /** 作品目录，形如 press/{作品名}，宿主须回查作品真实性 */
    dirPath: string
    readme?: PressApplyMeta
    /** README.md 中「作品设定」段落的正文（设定页基本信息分组） */
    basic?: string
    /** 世界观.md 中「提取设定」段落的正文（设定页世界观分组） */
    world?: string
    /** 金手指.md 中「提取设定」段落的正文（设定页金手指分组） */
    power?: string
    /** 势力.md 的条目块：按二级标题合并 */
    factions?: PressApplyBlock[]
    /** 地点.md 的条目块：按二级标题合并 */
    places?: PressApplyBlock[]
    /** 物品.md 的条目块：按二级标题合并 */
    items?: PressApplyBlock[]
    /** 角色块：name 用作匹配键，text 是含「## 名称」标题行的完整块（块内三级分组、四级字段） */
    characters?: PressApplyBlock[]
    /** 大纲.md 的功能模块段落：键为白名单，值为该段正文，未带的段落保持原样 */
    outlineSections?: Partial<Record<PressOutlineSectionKey, string>>
    /** 需从 角色设定.md 移除的角色块：按块标题名匹配（一级/二级都认），与 characters 同时生效 */
    deletedCharacterNames?: string[]
    /** 需从 势力.md 移除的条目块：按二级标题名匹配 */
    deletedFactionNames?: string[]
    /** 需从 地点.md 移除的条目块 */
    deletedPlaceNames?: string[]
    /** 需从 物品.md 移除的条目块 */
    deletedItemNames?: string[]
    /** 需一并清理设定图的角色标识：扁平目录按文件名中的角色段过滤 */
    deletedCharacterIds?: string[]
    /** 需一并清理设定图的条目标识：按 faction- / place- / item- 命名中的条目段过滤 */
    deletedLoreIds?: string[]
}

/** 单份文档的写入上限：正常作品远低于该值，超出视为异常请求 */
const MAX_APPLY_FIELD_LENGTH = 2_000_000

/** 角色块与删除名单的条目上限：正常作品远低于该值，超出视为异常请求 */
const MAX_APPLY_CHARACTERS = 5000

/** 校验单个回写块：标题非空、正文不超过单份文档上限 */
function isApplyBlock(item: unknown): boolean {
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
}

/** 校验回写块列表：允许缺省，出现时须是限额内的合法块数组 */
function isApplyBlockList(value: unknown): boolean {
    if (value === undefined) {
        return true
    }
    if (!Array.isArray(value) || value.length > MAX_APPLY_CHARACTERS) {
        return false
    }
    return value.every(isApplyBlock)
}

/** 校验删除名单：允许缺省，出现时须是限额内的非空名称数组 */
function isApplyNameList(value: unknown): boolean {
    if (value === undefined) {
        return true
    }
    if (!Array.isArray(value) || value.length > MAX_APPLY_CHARACTERS) {
        return false
    }
    return value.every((name: unknown) => typeof name === 'string' && name.length > 0)
}

/** 校验标识名单：允许缺省，出现时须是限额内且通过守卫的标识数组 */
function isApplyIdList(value: unknown, guard: (item: unknown) => boolean): boolean {
    if (value === undefined) {
        return true
    }
    if (!Array.isArray(value) || value.length > MAX_APPLY_CHARACTERS) {
        return false
    }
    return value.every(guard)
}

/** 校验单份段落正文：允许缺省，出现时必须是未超单份文档上限的字符串 */
function isApplySectionText(value: unknown): boolean {
    if (value === undefined) {
        return true
    }
    return typeof value === 'string' && value.length <= MAX_APPLY_FIELD_LENGTH
}

/** 校验大纲分段：键必须在白名单内，每个值都是未超单份文档上限的字符串 */
function isApplyOutlineSections(value: unknown): boolean {
    if (value === undefined) {
        return true
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false
    }
    return Object.entries(value as Record<string, unknown>).every(
        ([key, text]) => PRESS_OUTLINE_SECTION_KEYS.some((item) => item === key) && isApplySectionText(text),
    )
}

/** 校验 README 元信息：标题与读者允许为空，但类型与字数目标必须合法 */
function isApplyMeta(value: unknown): value is PressApplyMeta {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const meta = value as { title?: unknown; audience?: unknown; genres?: unknown; wordGoal?: unknown }
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

/**
 * 判断是否为合法的回写请求：逐字段校验类型与规模，未提供的字段不参与校验。
 * 关键约束：至少要带一份内容或一条删除名单，否则空请求会把四份文档无意义地重写一遍。
 */
export function isPressApplyRequest(payload: unknown): payload is PressApplyRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as {
        readme?: unknown
        basic?: unknown
        world?: unknown
        power?: unknown
        factions?: unknown
        places?: unknown
        items?: unknown
        characters?: unknown
        outlineSections?: unknown
        deletedCharacterNames?: unknown
        deletedFactionNames?: unknown
        deletedPlaceNames?: unknown
        deletedItemNames?: unknown
        deletedCharacterIds?: unknown
        deletedLoreIds?: unknown
    }
    const hasContent =
        candidate.readme !== undefined ||
        candidate.basic !== undefined ||
        candidate.world !== undefined ||
        candidate.power !== undefined ||
        candidate.factions !== undefined ||
        candidate.places !== undefined ||
        candidate.items !== undefined ||
        candidate.characters !== undefined ||
        candidate.outlineSections !== undefined ||
        candidate.deletedCharacterNames !== undefined ||
        candidate.deletedFactionNames !== undefined ||
        candidate.deletedPlaceNames !== undefined ||
        candidate.deletedItemNames !== undefined ||
        candidate.deletedCharacterIds !== undefined ||
        candidate.deletedLoreIds !== undefined
    if (!hasContent) {
        return false
    }
    if (candidate.readme !== undefined && !isApplyMeta(candidate.readme)) {
        return false
    }
    if (
        !isApplySectionText(candidate.basic) ||
        !isApplySectionText(candidate.world) ||
        !isApplySectionText(candidate.power) ||
        !isApplyOutlineSections(candidate.outlineSections)
    ) {
        return false
    }
    if (
        !isApplyBlockList(candidate.factions) ||
        !isApplyBlockList(candidate.places) ||
        !isApplyBlockList(candidate.items) ||
        !isApplyBlockList(candidate.characters)
    ) {
        return false
    }
    if (
        !isApplyNameList(candidate.deletedCharacterNames) ||
        !isApplyNameList(candidate.deletedFactionNames) ||
        !isApplyNameList(candidate.deletedPlaceNames) ||
        !isApplyNameList(candidate.deletedItemNames)
    ) {
        return false
    }
    if (!isApplyIdList(candidate.deletedCharacterIds, isPressCharacterId)) {
        return false
    }
    if (!isApplyIdList(candidate.deletedLoreIds, isPressLoreId)) {
        return false
    }
    return true
}

/** press/apply 响应：written 为实际写入的文件名，便于前端提示写了哪些文档 */
export interface PressApplyResult {
    written: string[]
}

/**
 * 快照收录的文档键：与 PressWorkspaceFiles 同键。
 * README 一并纳入——书名、题材、目标字数同属「设定」语义，割裂会让「只改书名不产生快照」难以解释。
 */
export type PressSnapshotFileKey = keyof PressWorkspaceFiles

/** 快照触发范围：README 随设定一起写入，故不作为独立触发项，只用于标注本次是哪个分区改动 */
export type PressSnapshotTrigger = Exclude<PressSnapshotFileKey, 'readme'>

/** 快照来源：auto 为内容变更自动保存，manual 为用户手动创建，restore 为恢复前留底 */
export type PressSnapshotReason = 'auto' | 'manual' | 'restore'

/** 快照条目：列表只下发元信息，正文本地按需读取，避免一次列出几十版就搬运整部作品 */
export interface PressSnapshotEntry {
    /** 目录名即标识，形如 20261024-153012-a1b2c3 */
    id: string
    createdAt: string
    reason: PressSnapshotReason
    trigger: PressSnapshotTrigger[]
    /** 手动快照的备注，自动快照为空串 */
    label: string
    /** 与上一版相比内容变化的文档；首版为收录的全部文档 */
    changed: PressSnapshotFileKey[]
    sizeBytes: number
}

/** press/snapshot/list 请求 */
export interface PressSnapshotListRequest {
    dirPath: string
}

/** press/snapshot/list 响应：按创建时间倒序 */
export interface PressSnapshotListResult {
    snapshots: PressSnapshotEntry[]
}

/** press/snapshot/create 请求：手动留一版，label 为备注 */
export interface PressSnapshotCreateRequest {
    dirPath: string
    label?: string
}

/** press/snapshot/create 响应 */
export interface PressSnapshotCreateResult {
    snapshot: PressSnapshotEntry
}

/** press/snapshot/restore 请求：files 缺省表示整版恢复，指定则只覆盖这几份文档 */
export interface PressSnapshotRestoreRequest {
    dirPath: string
    snapshotId: string
    files?: PressSnapshotFileKey[]
}

/** press/snapshot/restore 响应：实际写回的文档 */
export interface PressSnapshotRestoreResult {
    restored: PressSnapshotFileKey[]
}

/** press/snapshot/delete 请求：只删这一版，不影响其它版本 */
export interface PressSnapshotDeleteRequest {
    dirPath: string
    snapshotId: string
}

/** press/snapshot/delete 响应 */
export interface PressSnapshotDeleteResult {
    deleted: boolean
}

/** 快照标识：14 位年月日时分秒 + 6 位随机十六进制，同时作为目录名，天然不含路径分隔符 */
const PRESS_SNAPSHOT_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/

/** 判断快照标识是否合法：恢复与删除前必须先过这一关，避免拼出越界路径 */
export function isPressSnapshotId(value: unknown): value is string {
    return typeof value === 'string' && PRESS_SNAPSHOT_ID_PATTERN.test(value)
}

/** 判断是否为合法的快照列举请求（类型收窄辅助）：与作品目录请求同形 */
export function isPressSnapshotListRequest(payload: unknown): payload is PressSnapshotListRequest {
    return isPressDirPath(payload)
}

/** 判断是否为合法的手动快照请求（类型收窄辅助）：备注可选，超长备注由宿主截断而非拒绝 */
export function isPressSnapshotCreateRequest(payload: unknown): payload is PressSnapshotCreateRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const label = (payload as { label?: unknown }).label
    return label === undefined || typeof label === 'string'
}

/** 判断是否为合法的恢复请求（类型收窄辅助）：files 可选，出现时必须全部是收录键 */
export function isPressSnapshotRestoreRequest(payload: unknown): payload is PressSnapshotRestoreRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    const candidate = payload as { snapshotId?: unknown; files?: unknown }
    if (!isPressSnapshotId(candidate.snapshotId)) {
        return false
    }
    if (candidate.files === undefined) {
        return true
    }
    return Array.isArray(candidate.files) && candidate.files.every(isPressSnapshotFileKey)
}

/** 判断是否为合法的删除快照请求（类型收窄辅助） */
export function isPressSnapshotDeleteRequest(payload: unknown): payload is PressSnapshotDeleteRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    return isPressSnapshotId((payload as { snapshotId?: unknown }).snapshotId)
}

/** 判断是否为快照收录键：白名单收窄，避免前端传入任意字段名被当成文件名拼进路径 */
export function isPressSnapshotFileKey(value: unknown): value is PressSnapshotFileKey {
    return value === 'readme' || value === 'setting' || value === 'characters' || value === 'outline'
}

/**
 * 正文快照来源：auto 为保存后自动留版，ai-write 为 AI 写回前强制留底，
 * manual 为用户手动创建，restore 为恢复前留底。
 */
export type ChapterSnapshotReason = 'auto' | 'ai-write' | 'manual' | 'restore'

/** 单章某一版：只含元信息，正文按需读取 */
export interface ChapterSnapshotEntry {
    id: string
    /** 章节相对存储根的路径，记录留版当时的取值，便于章重命名后排查 */
    chapterPath: string
    title: string
    createdAt: string
    reason: ChapterSnapshotReason
    /** 手动留版的备注，自动留版为空串 */
    label: string
    sizeBytes: number
}

/** 章节清单项：只列有快照的章，供界面左侧选择 */
export interface ChapterSnapshotSummary {
    chapterPath: string
    title: string
    /** 卷目录名（章直接位于 Chapters 下时为空串），用于分组 */
    volume: string
    versionCount: number
    latestAt: string
}

/** press/snapshot/chapter/list 请求 */
export interface ChapterSnapshotListRequest {
    dirPath: string
}

/** press/snapshot/chapter/list 响应：按最近留版时间倒序 */
export interface ChapterSnapshotListResult {
    chapters: ChapterSnapshotSummary[]
}

/** press/snapshot/chapter/versions 请求 */
export interface ChapterSnapshotVersionsRequest {
    dirPath: string
    chapterPath: string
}

/** press/snapshot/chapter/versions 响应：按创建时间倒序 */
export interface ChapterSnapshotVersionsResult {
    versions: ChapterSnapshotEntry[]
}

/** press/snapshot/chapter/capture 请求：手动给某章留一版 */
export interface ChapterSnapshotCaptureRequest {
    dirPath: string
    chapterPath: string
    label?: string
}

/** press/snapshot/chapter/capture 响应 */
export interface ChapterSnapshotCaptureResult {
    snapshot: ChapterSnapshotEntry
}

/** press/snapshot/chapter/restore 请求 */
export interface ChapterSnapshotRestoreRequest {
    dirPath: string
    chapterPath: string
    snapshotId: string
}

/** press/snapshot/chapter/restore 响应：false 表示内容与所选版本一致，未写盘 */
export interface ChapterSnapshotRestoreResult {
    restored: boolean
}

/** press/snapshot/chapter/delete 请求 */
export interface ChapterSnapshotDeleteRequest {
    dirPath: string
    chapterPath: string
    snapshotId: string
}

/** press/snapshot/chapter/delete 响应 */
export interface ChapterSnapshotDeleteResult {
    deleted: boolean
}

/**
 * 判断章节路径是否具备基本形态：相对路径、Markdown 结尾、不含上跳与盘符。
 * 关键约束：本函数只做格式初筛，是否真属于该作品的 Chapters 目录由宿主结合片段校验判定。
 */
function isChapterPathShape(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
        return false
    }
    if (value.includes('..') || value.includes(':')) {
        return false
    }
    if (value.startsWith('/') || value.startsWith('\\')) {
        return false
    }
    return value.toLowerCase().endsWith('.md')
}

/** 判断是否为合法的章节快照清单请求（类型收窄辅助） */
export function isChapterSnapshotListRequest(payload: unknown): payload is ChapterSnapshotListRequest {
    return isPressDirPath(payload)
}

/** 判断是否为合法的章节版本列表请求（类型收窄辅助） */
export function isChapterSnapshotVersionsRequest(payload: unknown): payload is ChapterSnapshotVersionsRequest {
    if (!isPressDirPath(payload)) {
        return false
    }
    return isChapterPathShape((payload as { chapterPath?: unknown }).chapterPath)
}

/** 判断是否为合法的章节手动留版请求（类型收窄辅助） */
export function isChapterSnapshotCaptureRequest(payload: unknown): payload is ChapterSnapshotCaptureRequest {
    if (!isChapterSnapshotVersionsRequest(payload)) {
        return false
    }
    const label = (payload as { label?: unknown }).label
    return label === undefined || typeof label === 'string'
}

/** 判断是否为合法的章节恢复请求（类型收窄辅助） */
export function isChapterSnapshotRestoreRequest(payload: unknown): payload is ChapterSnapshotRestoreRequest {
    if (!isChapterSnapshotVersionsRequest(payload)) {
        return false
    }
    return isPressSnapshotId((payload as { snapshotId?: unknown }).snapshotId)
}

/** 判断是否为合法的章节快照删除请求（类型收窄辅助） */
export function isChapterSnapshotDeleteRequest(payload: unknown): payload is ChapterSnapshotDeleteRequest {
    return isChapterSnapshotRestoreRequest(payload)
}

/**
 * 活跃作品快照：面板打开时按需请求，命中即让仪表盘直接进入该作品的章节列表。
 * 约束：activeProjectDirPath 为 press/{作品名} 且须在索引库内，焦点不在作品文档（或落在索引外）时为 null。
 */
export interface PressActiveState {
    activeProjectDirPath: string | null
}

/** 判断是否为合法的活跃作品快照（类型收窄辅助） */
export function isPressActiveState(payload: unknown): payload is PressActiveState {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { activeProjectDirPath?: unknown }
    return candidate.activeProjectDirPath === null || typeof candidate.activeProjectDirPath === 'string'
}

/**
 * press-workspace 通道载荷：仪表盘对作品的卷章结构做了写操作后，通知工作流面板重读。
 * 工作区只在与当前打开的作品目录一致时重读，避免别处的新增触发无谓读盘。
 */
export interface PressWorkspaceChangedState {
    /** 结构发生变更的作品目录，形如 press/{作品名} */
    dirPath: string
}

/** 判断是否为合法的作品结构变更通知（类型收窄辅助） */
export function isPressWorkspaceChangedState(payload: unknown): payload is PressWorkspaceChangedState {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { dirPath?: unknown }
    return typeof candidate.dirPath === 'string' && candidate.dirPath.length > 0
}
