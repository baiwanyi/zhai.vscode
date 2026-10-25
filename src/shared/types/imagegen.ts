/**
 * 生图模块契约：图片条目、统一图库的列举/删除/设封面、按提示词生成、生成参数与图片标识规则。
 * 复用约定：图片风格沿用 ./press 的 PortraitStyle 与 PORTRAIT_STYLES，作品目录口径与 press 一致；
 * 图片标识由文件名解析，不另建关联表——portrait 段携带角色标识，其余一律视为普通图片。
 * 关键约束：新增/旧命名的解析规则必须并存（旧照只读兼容、新图按新规则写入），
 * 时间戳在前、角色标识在后的新规则与「角色标识在前」的旧规则互不误判；
 * 宿主不接受前端传入的任意路径，删除与设封面前必须按 dirPath 校验归属。
 */
import type { PortraitStyle } from './press'

/**
 * 图片类别：角色图、普通图片、无法解析归属的孤儿图。
 * 「当前是否为作品封面」不参与分类——任何一张图都可能被设为封面，
 * 由 coverSelectedId 与图片 id 比较得出，避免同一张图出现两种类型。
 */
export type PressImageKind = 'portrait' | 'photo' | 'orphan'

/** 生成意图：决定落盘命名与是否自动设封面 */
export type ImageGenerateKind = 'cover' | 'portrait' | 'photo'

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

/** 图库列举请求：只带作品目录 */
export interface ImageLibraryRequest {
    dirPath: string
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

/** 设为作品封面请求：任意已落盘的图片都可以成为作品封面 */
export interface ImageSetCoverRequest {
    dirPath: string
    path: string
}

/** 设为作品封面结果 */
export interface ImageSetCoverResult {
    coverSelectedId: string | null
}

/** 按提示词生成图片请求：提示词由前端拼装完成，宿主只做校验、出图与落盘 */
export interface ImageGenerateRequest {
    dirPath: string
    /** 已拼装的图像提示词（含画风、设定快照与负向约束） */
    prompt: string
    kind: ImageGenerateKind
    /** portrait 必填，其余必须为 null */
    characterId: string | null
    ratio: ImageRatio
    style: PortraitStyle
    /** 用户点击「增强提示词」前的原始输入：仅用于落盘 sidecar 复现，未增强时省略 */
    enhancedFrom?: string
}

/** 生成结果：新图是否自动成为作品封面 / 角色封面由 kind 与 characterId 决定 */
export interface ImageGenerateResult {
    image: PressImageItem
    coverSelectedId: string | null
    characterCoverId: string | null
}

/** 生成参数：作品级可覆盖项，配额与超时不在此列 */
export interface ImageSettings {
    /** 每次打开 composer 时默认选中的比例 */
    defaultRatio: ImageRatio
    /** 角色图默认画风 */
    portraitStyle: PortraitStyle
    /** 作品封面与普通图默认画风 */
    coverStyle: PortraitStyle
    /** 附加风格补充：拼在提示词末尾 */
    promptSuffix: string
    /** 负向约束：拼在提示词末尾的「避免」段 */
    negative: string
}

/** 参数默认值：前端选项与宿主回落共用同一份，避免两处口径分叉 */
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    defaultRatio: '3:4',
    portraitStyle: 'auto',
    coverStyle: 'auto',
    promptSuffix: '',
    negative: '',
}

/** 参数读取结果：overrides 列出本作品已覆盖的键，其余跟随全局配置 */
export interface ImageSettingsResult {
    settings: ImageSettings
    overrides: ReadonlyArray<keyof ImageSettings>
}

/** 参数保存请求：只传改动项，值为 null 表示取消覆盖、回落到全局 */
export interface ImageSettingsSaveRequest {
    dirPath: string
    settings: Partial<Record<keyof ImageSettings, ImageSettings[keyof ImageSettings] | null>>
}

/** 侧车元数据：与图片同名落盘，供详情展示、复现参数与搜索命中 */
export interface ImagePromptMeta {
    prompt: string
    ratio: ImageRatio
    style: PortraitStyle
    characterId: string | null
    /** 增强前的原始输入；未增强时为 null */
    enhancedFrom: string | null
    createdAt: string
}

/** 时间戳位数：年月日时分秒共 14 位 */
const TIMESTAMP_LENGTH = 14
/** 角色标识位数：8 位随机数字，与人物卡标识一致 */
const CHARACTER_ID_LENGTH = 8
/** 普通图片随机段位数 */
const RANDOM_SUFFIX_LENGTH = 8

/** 新角色图：portrait-{14 位时间戳}-{8 位角色标识} */
const PORTRAIT_ID_PATTERN = new RegExp(
    `^portrait-\\d{${String(TIMESTAMP_LENGTH)}}-\\d{${String(CHARACTER_ID_LENGTH)}}$`,
)
/** 旧角色图：portrait-{8 位角色标识}-{14 位时间戳}，仅读取兼容 */
const LEGACY_PORTRAIT_ID_PATTERN = new RegExp(
    `^portrait-\\d{${String(CHARACTER_ID_LENGTH)}}-\\d{${String(TIMESTAMP_LENGTH)}}$`,
)
/** 普通图片：photo-{14 位时间戳}-{8 位字母数字} */
const PHOTO_ID_PATTERN = new RegExp(
    `^photo-\\d{${String(TIMESTAMP_LENGTH)}}-[A-Za-z0-9]{${String(RANDOM_SUFFIX_LENGTH)}}$`,
)
/** 旧作品封面：cover-{14 位时间戳}，仅读取兼容 */
const LEGACY_COVER_ID_PATTERN = new RegExp(`^cover-\\d{${String(TIMESTAMP_LENGTH)}}$`)

/** 判断图片标识是否合法：列举、删除与封面指针校验共用同一口径 */
export function isPressImageId(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false
    }
    return (
        PORTRAIT_ID_PATTERN.test(value) ||
        LEGACY_PORTRAIT_ID_PATTERN.test(value) ||
        PHOTO_ID_PATTERN.test(value) ||
        LEGACY_COVER_ID_PATTERN.test(value)
    )
}

/** 按标识判定类别：两个 portrait 规则都返回 portrait，封面旧命名归入普通图 */
export function parseImageKind(id: string): PressImageKind {
    if (PORTRAIT_ID_PATTERN.test(id) || LEGACY_PORTRAIT_ID_PATTERN.test(id)) {
        return 'portrait'
    }
    if (PHOTO_ID_PATTERN.test(id) || LEGACY_COVER_ID_PATTERN.test(id)) {
        return 'photo'
    }
    return 'orphan'
}

/**
 * 从图片标识解析所属角色：新规则取末段，旧规则取第二段。
 * 两种规则的段长度不同，先后顺序不影响结果，因此可安全并存。
 */
export function parseImageCharacterId(id: string): string | null {
    const segments = id.split('-')
    if (PORTRAIT_ID_PATTERN.test(id)) {
        return segments[2] ?? null
    }
    if (LEGACY_PORTRAIT_ID_PATTERN.test(id)) {
        return segments[1] ?? null
    }
    return null
}

/** 由时间戳与角色标识拼出角色图标识：时间戳必须是 14 位数字串 */
export function formatPortraitId(timestamp: string, characterId: string): string {
    return `portrait-${timestamp}-${characterId}`
}

/** 由时间戳与随机段拼出普通图片标识 */
export function formatPhotoId(timestamp: string, random: string): string {
    return `photo-${timestamp}-${random}`
}
