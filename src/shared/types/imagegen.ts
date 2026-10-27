/**
 * 生图模块契约：图片条目、统一图库的列举/删除/设封面、按提示词生成、生成参数与图片标识规则。
 * 复用约定：图片风格沿用 ./press 的 PortraitStyle 与 PORTRAIT_STYLES，作品目录口径与 press 一致；
 * 图片标识由文件名解析，不另建关联表——portrait 段携带角色标识，其余一律视为普通图片。
 * 关键约束：只认当前命名（portrait-{时间戳}-{角色标识} 与 photo-{时间戳}-{随机段}），历史命名一律归为孤儿图；
 * 宿主不接受前端传入的任意路径，删除与设封面前必须按 dirPath 校验归属。
 */
import type { PortraitStyle } from './press'

/**
 * 图片类别：角色图、普通图片、无法解析归属的孤儿图。
 * 「当前是否为作品封面」不参与分类——任何一张图都可能被设为封面，
 * 由 coverSelectedId 与图片 id 比较得出，避免同一张图出现两种类型。
 */
export type PressImageKind = 'portrait' | 'photo' | 'orphan'

/**
 * 生成意图：只有角色卡与其他图片两种，决定落盘命名（角色图带角色段，其余随机段）。
 * 「作品封面」不是生成意图——任意一张非角色图都可以在详情里设为封面。
 */
export type ImageGenerateKind = 'portrait' | 'photo'

/** 画面比例 */
export type ImageRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16'

/** 比例白名单：前端选项与宿主入参校验共用同一份 */
export const IMAGE_RATIOS: readonly ImageRatio[] = ['1:1', '3:4', '4:3', '16:9', '9:16']

/** 比例到像素的固定映射：通道只接受 WxH，换算集中在此，避免前后端各算一套 */
export const IMAGE_RATIO_SIZE: Readonly<Record<ImageRatio, string>> = {
    '1:1': '1024x1024',
    '3:4': '768x1024',
    '4:3': '1024x768',
    '16:9': '1280x720',
    '9:16': '720x1280',
}

/** 比例收窄：非白名单值一律不通过 */
export function isImageRatio(value: unknown): value is ImageRatio {
    return typeof value === 'string' && IMAGE_RATIOS.some((item) => item === value)
}

/** 图库条目：一次列举返回 webview 可直接渲染的最小集合 */
export interface PressImageItem {
    /** 图片标识：文件名去掉扩展名 */
    id: string
    kind: PressImageKind
    /** 相对存储根路径，形如 press/{作品名}/Images/photo-xxx.png */
    path: string
    /** webview 可访问的完整 URL，仅本次会话有效（由宿主用 asWebviewUri 转换） */
    url: string
    createdAt: string
    /** 角色图所属的角色标识；普通图与孤儿图为 null */
    characterId: string | null
}

/** 图库列举结果：按生成时间降序，最新在前；counts 供筛选条显示分项数量 */
export interface ImageLibraryResult {
    images: PressImageItem[]
    /** 作品封面当前指向的图片 id */
    coverSelectedId: string | null
    counts: Record<PressImageKind, number>
}

/** 删除图片请求：path 必须是 listImageLibrary 返回的相对路径 */
export interface ImageDeleteRequest {
    dirPath: string
    path: string
}

/**
 * 图片详情：读取同名侧车（出图参数快照）。
 * 旧图没有侧车、文件损坏或字段类型不符时对应项为 null，界面据此隐藏参数区。
 */
export interface ImageDetailResult {
    prompt: string | null
    ratio: string | null
    style: string | null
    characterId: string | null
    enhancedFrom: string | null
    createdAt: string | null
}

/**
 * 删除图片结果：前端据此一次性修好两处指针，不再二次请求。
 * characterId 非空且 nextPortraitId 变化时，调用方需把该角色的封面指针改为 nextPortraitId。
 */
export interface ImageDeleteResult {
    removed: boolean
    /** 删除后作品封面回退到的图片 id */
    coverSelectedId: string | null
    /** 被删图所属角色；非角色图为 null */
    characterId: string | null
    /** 该角色删除后剩余最新一张的 id；无剩余为 null */
    nextPortraitId: string | null
}

/** 设为作品封面结果 */
export interface ImageSetCoverResult {
    coverSelectedId: string | null
}

/** 按提示词生成图片请求：正文由前端拼装，词条文本由宿主换取，画风与负向约束由宿主追加 */
export interface ImageGenerateRequest {
    dirPath: string
    /** 已拼装的图像提示词（含设定快照；不含词条、画风与负向约束） */
    prompt: string
    /**
     * 词条芯片的标识：{分类}::{分组}::{名称}，由词库 md 生成。
     * 宿主据此回查 md 取原文、归一化后与正文合并；词条顺序即芯片顺序。
     */
    promptTags?: string[]
    /**
     * 上下文段：「添加上下文」菜单添加的内容（如作品设定），由前端按芯片顺序展开。
     * 它不进 prompt 字段，宿主接在正文之后、规则之前，作为画面背景而非画面描述。
     */
    contexts?: string[]
    /**
     * 规则芯片的标识：{存储根}/prompt/rules 下的文件名主干，同样属于上下文而非提示词正文。
     * 规则正文不进前端，由宿主读盘后作为约束段并入；顺序即芯片顺序。
     */
    promptRules?: string[]
    /**
     * 参考图芯片的本地路径：只接受 Host 选择流程登记过的图片。
     * 图片作为多模态输入随指令提交，供模型观察主体与构图；不写进提示词正文。
     */
    referenceImages?: string[]
    kind: ImageGenerateKind
    /** portrait 必填，其余必须为 null */
    characterId: string | null
    ratio: ImageRatio
    style: PortraitStyle
    /** 用户点击「增强提示词」前的原始输入：仅用于落盘 sidecar 复现，未增强时省略 */
    enhancedFrom?: string
}

/**
 * 生成结果：只回传新图本身，生成不影响作品封面。
 * 角色封面不在此回传——前端在生成回执后按「该角色尚无封面」自行写回人物卡，避免两套写回口径。
 */
export interface ImageGenerateResult {
    image: PressImageItem
}

/**
 * 参考图条目：由宿主文件选择流程产出，前端只持有回传结果，不自行拼路径。
 * url 仅本次会话有效，供芯片缩略图与悬停预览使用。
 */
export interface ImageReferenceItem {
    /** 磁盘绝对路径：发送时原样回传，宿主按登记表校验后才读取 */
    path: string
    /** 文件名：芯片主文案 */
    name: string
    /** webview 可访问的完整 URL */
    url: string
}

/** 选择参考图结果：用户取消选择框时 reference 为 null，前端静默忽略 */
export interface ImageReferencePickResult {
    reference: ImageReferenceItem | null
}

/** 生成参数：作品级可覆盖项，配额与超时不在此列 */
export interface ImageSettings {
    /** 每次打开 composer 时默认选中的比例 */
    defaultRatio: ImageRatio
    /** 角色图与普通图默认画风 */
    portraitStyle: PortraitStyle
    /** 附加风格补充：拼在提示词末尾 */
    promptSuffix: string
    /** 负向约束：拼在提示词末尾的「避免」段 */
    negative: string
}

/** 参数默认值：前端选项与宿主回落共用同一份，避免两处口径分叉 */
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    defaultRatio: '3:4',
    portraitStyle: 'auto',
    promptSuffix: '',
    negative: '',
}

/** 参数读取结果：overrides 列出本作品已覆盖的键，其余跟随全局配置 */
export interface ImageSettingsResult {
    settings: ImageSettings
    overrides: ReadonlyArray<keyof ImageSettings>
}

/** 批量删除结果：removals 逐张回执，library 为删除后重新列举得到的列表 */
export interface ImageBatchDeleteResult {
    removals: { path: string; removed: boolean }[]
    library: ImageLibraryResult
}

/**
 * 提示词预览图基址：词条数据只存文件名，宿主把图库目录转成 webview 可访问的 URL 后由前端拼接。
 * baseUrl 为 null 表示目录不存在或没有任何图片，此时面板不渲染缩略图，只显示文字按钮。
 */
export interface PromptImageBase {
    /** 图库目录的 webview URL，不带结尾斜杠；目录为空时为 null */
    baseUrl: string | null
    /** 图库目录的本地绝对路径：空态直接展示，用户据此把图片放进去 */
    dirPath: string
}

/**
 * 出图规则：{存储根}/prompt/rules 下的 md 文件，全局共享、与作品无关。
 * 前端只持有标识，正文由宿主读盘并入，因此规则改文无需重新进页面。
 */
export interface PromptRule {
    /** 规则标识：文件名去掉 .md，芯片与出图请求都用它回查 */
    id: string
    /** 显示名：与标识同源，即文件名主干 */
    name: string
}

/** 规则列举结果：dirPath 始终回传，空态据此提示用户把 md 放到哪里 */
export interface PromptRuleListResult {
    rules: PromptRule[]
    dirPath: string
}

/** 规则保存请求：只新建、不覆盖，同名文件已存在时由宿主拒绝 */
export interface PromptRuleSaveRequest {
    /** 规则名，可带 .md 后缀，宿主统一去后缀后落盘 */
    name: string
    /** 规则正文：md 原文，选中后整段作为约束并入提示词 */
    content: string
}

/** 规则正文：仅供编辑弹窗回填，列表与出图请求都不携带 */
export interface PromptRuleDetail {
    /** 规则名：与文件名主干一致 */
    name: string
    /** 规则正文：md 原文（已去首尾空白） */
    content: string
}

/** 规则更新请求：整段替换正文，改名时以新名落盘并清理旧文件 */
export interface PromptRuleUpdateRequest {
    /** 原规则名：定位待改写的 md 文件 */
    previousName: string
    /** 新规则名：与原名不同即视为改名，重名由宿主拒绝 */
    name: string
    /** 新正文：md 原文，整段替换旧内容 */
    content: string
}

/**
 * 提示词词条：{存储根}/prompt/tags/*.md 中的一条，全局共享、与作品无关。
 * 标识由「分类::分组::名称」组成，改名即换标识；芯片只携带标识，原文由宿主按标识回查。
 */
export interface PromptTag {
    /** 词条标识：{分类}::{分组}::{名称}，芯片与出图请求都用它回查 */
    id: string
    /** 一级分类：md 文件的 `#` 标题，同时是文件名主干 */
    object: string
    /** 二级分组：md 文件内的 `##` 标题 */
    attribute: string
    /** 词条名：md 文件内的 `###` 标题，同组内唯一 */
    name: string
    /** 提示词原文：md 中标题下的正文，发送时归一化后并入提示词 */
    prompt: string
    /** 预览图相对 prompt/images 的路径（正斜杠），null 表示没有图 */
    preview: string | null
}

/** 二级分组：count 为该组词条数 */
export interface PromptTagAttribute {
    name: string
    count: number
}

/** 一级分类：attributes 为分类下的分组，顺序与 md 一致 */
export interface PromptTagObject {
    name: string
    attributes: PromptTagAttribute[]
}

/** 词库列举结果：tags 为扁平列表，关键词搜索在前端内存中完成 */
export interface PromptTagListResult {
    objects: PromptTagObject[]
    tags: PromptTag[]
    /** tags 目录本地路径：空态据此提示用户把 md 放到哪里 */
    dirPath: string
    /** images 目录本地路径：无图时提示图片该放到哪里 */
    imageDirPath: string
}

/** 词条新建请求：分类或分组不存在时由宿主新建 */
export interface PromptTagSaveRequest {
    object: string
    attribute: string
    name: string
    prompt: string
}

/** 词条更新请求：previousId 定位原块，改名或换组即整块移动 */
export interface PromptTagUpdateRequest {
    /** 原词条标识：定位待改写的块 */
    previousId: string
    object: string
    attribute: string
    name: string
    prompt: string
}

/** 时间戳位数：年月日时分秒共 14 位 */
const TIMESTAMP_LENGTH = 14
/** 角色标识位数：8 位随机数字，与人物卡标识一致 */
const CHARACTER_ID_LENGTH = 8
/** 普通图片随机段位数 */
const RANDOM_SUFFIX_LENGTH = 8

/** 角色图：portrait-{14 位时间戳}-{8 位角色标识} */
const PORTRAIT_ID_PATTERN = new RegExp(
    `^portrait-\\d{${String(TIMESTAMP_LENGTH)}}-\\d{${String(CHARACTER_ID_LENGTH)}}$`,
)
/** 普通图片：photo-{14 位时间戳}-{8 位字母数字} */
const PHOTO_ID_PATTERN = new RegExp(
    `^photo-\\d{${String(TIMESTAMP_LENGTH)}}-[A-Za-z0-9]{${String(RANDOM_SUFFIX_LENGTH)}}$`,
)

/** 判断图片标识是否合法：列举、删除与封面指针校验共用同一口径 */
export function isPressImageId(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false
    }
    return PORTRAIT_ID_PATTERN.test(value) || PHOTO_ID_PATTERN.test(value)
}

/** 按标识判定类别：portrait 前缀为角色图，photo 前缀为普通图，其余为孤儿图 */
export function parseImageKind(id: string): PressImageKind {
    if (PORTRAIT_ID_PATTERN.test(id)) {
        return 'portrait'
    }
    if (PHOTO_ID_PATTERN.test(id)) {
        return 'photo'
    }
    return 'orphan'
}

/** 从图片标识解析所属角色：角色段固定在第 3 段 */
export function parseImageCharacterId(id: string): string | null {
    if (!PORTRAIT_ID_PATTERN.test(id)) {
        return null
    }
    const segments = id.split('-')
    return segments[2] ?? null
}
