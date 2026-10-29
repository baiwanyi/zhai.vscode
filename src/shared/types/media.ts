/**
 * 媒体库契约：媒体条目、引用关系、年月筛选与各协议的出入参模型。
 * 复用约定：条目分类沿用 ./press 的 PressLoreKind；路径一律为相对存储根的 images/{YYYYMM}/{文件}，
 * 条目 id 即文件名主干，前端只持有 id，落盘路径由宿主查表得出。
 * 关键约束：id 为 14 位本地时间戳 + 6 位 [A-Za-z0-9] 随机段，语义不进文件名；
 * 出处（作品 / 角色 / 条目）写入后不再改写，引用为一行一条、天然一对多；
 * 手工放入的图片允许不符合命名规范，但路径必须落在 images/{YYYYMM}/ 下。
 */
import type { PressLoreKind } from './press'

/** 媒体来源作用域：作品、笔记、公众号与通用 */
export type MediaScope = 'press' | 'note' | 'wechat' | 'general'

/** 入库方式：出图产出、外部导入、历史迁移 */
export type MediaOrigin = 'generate' | 'import' | 'migrate'

/**
 * 条目分类：仅用于展示标签，不参与筛选。
 * 角色图、设定图、普通图与无法判定的图片（手工放入）四种。
 */
export type MediaKind = 'portrait' | 'lore' | 'photo' | 'unknown'

/** 引用方类型：三类封面 + 三类正文文档 */
export type MediaRefType = 'press_cover' | 'character_cover' | 'lore_cover' | 'chapter' | 'note' | 'external'

/** 引用路径的定位基准：存储根相对路径或绝对路径（存储根外的文档） */
export type MediaRefScope = 'storage' | 'absolute'

/** 引用基址：媒体路径的相对根目录名，扫描、列举与校验都以这里为准 */
export const MEDIA_DIR = 'images'

/** 媒体 id：14 位时间戳 + 6 位字母数字随机段 */
const MEDIA_ID_PATTERN = /^\d{14}[A-Za-z0-9]{6}$/
/** 媒体相对路径：images/{YYYYMM}/{文件名}，文件名允许手工命名 */
const MEDIA_PATH_PATTERN = /^images\/(\d{6})\/([^/]+)$/
/** 图片扩展名白名单：与宿主扫描口径同源 */
const MEDIA_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i
/** 年月格式：YYYY-MM */
const MEDIA_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** 媒体标识是否合法：迁移前的旧命名（portrait-…）不通过 */
export function isMediaId(value: unknown): value is string {
    return typeof value === 'string' && MEDIA_ID_PATTERN.test(value)
}

/** 媒体相对路径是否合法：必须落在 images/{YYYYMM}/ 下且扩展名在图片集合内 */
export function isMediaPath(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false
    }
    const matched = MEDIA_PATH_PATTERN.exec(value)
    return matched !== null && MEDIA_EXTENSION_PATTERN.test(matched[2] ?? '')
}

/** 从媒体路径取 id：文件名去掉扩展名；路径不合法时返回空串 */
export function readMediaIdFromPath(path: string): string {
    const fileName = path.split('/').pop() ?? ''
    return fileName.replace(/\.[^.]+$/u, '')
}

/** 年月是否合法：供协议入参收窄 */
export function isMediaMonth(value: unknown): value is string {
    return typeof value === 'string' && MEDIA_MONTH_PATTERN.test(value)
}

/**
 * 媒体条目：一次列举返回 webview 可直接渲染的最小集合。
 * usageCount 为引用条数，出处处字段为生成时的快照，对象被删除后依旧保留。
 */
export interface MediaItem {
    /** 媒体 id：文件名主干 */
    id: string
    /** 相对存储根的路径：images/202610/20261029153045aB3xK9.png */
    path: string
    /** webview 可访问的完整 URL，仅本次会话有效 */
    url: string
    ext: string
    byteSize: number
    /** 年月：YYYY-MM，本地时区 */
    month: string
    createdAt: string
    scope: MediaScope
    origin: MediaOrigin
    kind: MediaKind
    /** 出处：所属作品相对路径 press/{作品名} */
    pressPath: string | null
    pressName: string | null
    characterId: string | null
    characterName: string | null
    loreKind: PressLoreKind | null
    loreId: string | null
    loreName: string | null
    /** 引用条数：一行一条，同一文档内多次引用同一张图只算一条 */
    usageCount: number
    /** 索引有记录但磁盘文件已不在 */
    missing: boolean
    /**
     * 出图参数：只有详情接口回传真实值，列表接口一律为 null。
     * 提示词体积可达数 KB，全量列举时带上会让列表消息膨胀数倍。
     */
    prompt: string | null
    ratio: string | null
    style: string | null
    enhancedFrom: string | null
}

/** 引用条目：详情面板按类型分组展示 */
export interface MediaUsageItem {
    refType: MediaRefType
    refPath: string
    refScope: MediaRefScope
    refId: string | null
    refTitle: string | null
    refAnchor: string | null
    seenAt: string
}

/** 年月聚合：下拉选项与分组头共用 */
export interface MediaMonthCount {
    /** YYYY-MM */
    month: string
    count: number
}

/** 列举结果：默认全量按月分组，前端按组懒挂载 */
export interface MediaListResult {
    items: MediaItem[]
    months: MediaMonthCount[]
    total: number
}

/** 详情结果：条目本身 + 全部引用 */
export interface MediaDetailResult {
    item: MediaItem
    usages: MediaUsageItem[]
}

/** 删除单条结果：usages 回传被清掉的引用，供前端提示 */
export interface MediaDeleteResult {
    removed: boolean
    usages: MediaUsageItem[]
    /** 删除后作品封面回退到的 id；非作品封面时为 null */
    coverSelectedId: string | null
    /**
     * 角色封面回退：键为角色 id，值为该角色剩余最新一张图的 id（null 表示已无图）。
     * 只在被删图是该角色出处图时出现——人物卡封面字段由前端写回，宿主只给候选。
     */
    characterCoverFallbacks: Record<string, string | null>
    /** 条目封面回退：语义与角色一致，键为条目 id */
    loreCoverFallbacks: Record<string, string | null>
}

/** 批量删除结果：逐条回执 + 最新年月聚合 */
export interface MediaBatchDeleteResult {
    removals: { id: string; removed: boolean }[]
    months: MediaMonthCount[]
    total: number
}

/** 设为作品封面结果 */
export interface MediaSetCoverResult {
    coverSelectedId: string | null
}

/** 插入到编辑器结果：reason 区分无光标、未保存、非 Markdown 与写入失败 */
export interface MediaInsertResult {
    inserted: boolean
    reason?: 'no-editor' | 'unsaved' | 'not-markdown' | 'failed'
    /** 写入正文的图片引用：形如 @zhai/images/{YYYYMM}/{id}.png */
    refPath?: string
    /** true 表示该文档已引用过同一张图，本次未重复插入 */
    duplicated?: boolean
}

/** 复制到剪贴板结果 */
export interface MediaCopyResult {
    copied: boolean
    reason?: 'unsupported' | 'failed'
}

/** 对账结果：补录、标记丢失与路径纠正的数量 */
export interface MediaRescanResult {
    indexed: number
    missing: number
    corrected: number
    stale: number
}
