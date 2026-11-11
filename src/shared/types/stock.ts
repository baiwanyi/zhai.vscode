/**
 * 在线图库契约：Unsplash 搜索结果、本地已下载条目与 stock/* 协议的出入参模型。
 * 复用约定：图片落 {存储根}/unsplash/{YYYYMM}/{photoId}.{ext}，条目 id 即文件名主干；
 * scope 四值复用 @shared/types/media 的 MediaScope，年月收窄复用 isMediaMonth，不另立一套口径。
 * 关键约束：photoId 只允许 [A-Za-z0-9_-]，直接充当文件名，不做二次清洗；
 * thumbUrl 必须是宿主签发的本地地址，前端永不接触 unsplash.com 域名；
 * 密钥状态只回尾号，明文不出宿主。
 */
import type { MediaScope } from './media'

/** 在线图库目录名：与 images / notes / press 平级 */
export const STOCK_DIR = 'unsplash'

/** photoId 形态：Unsplash 的短 id，同时充当文件名主干 */
const STOCK_PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{5,32}$/
/** 文件名主干形态：手工放入 unsplash/ 的文件也允许，只要求能安全参与路径拼装 */
const STOCK_FILE_STEM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 图片方向筛选：与 Unsplash 的 orientation 参数同值 */
export type StockOrientation = 'landscape' | 'portrait' | 'squarish'

/** 图片标识是否合法：不合法的一律不得进入文件名与协议入参 */
export function isStockPhotoId(value: unknown): value is string {
    return typeof value === 'string' && STOCK_PHOTO_ID_PATTERN.test(value)
}

/**
 * 文件名主干是否安全：入库与本地插入用这一档，比 photoId 宽松。
 * 与 isStockPhotoId 的分工：本地已下载的图插入不需要回源 API，因此不必满足上游 id 的长度约束。
 */
export function isStockFileStem(value: unknown): value is string {
    return typeof value === 'string' && STOCK_FILE_STEM_PATTERN.test(value)
}

/** 方向是否合法：非法值按「不限」处理，不阻断整页 */
export function isStockOrientation(value: unknown): value is StockOrientation {
    return value === 'landscape' || value === 'portrait' || value === 'squarish'
}

/** 浏览流排序：与 Unsplash 的 order_by 同值；关键词搜索端点不支持排序 */
export type StockOrderBy = 'latest' | 'oldest' | 'popular'

/** 排序值是否合法：非法值按「默认」处理，不阻断整页 */
export function isStockOrderBy(value: unknown): value is StockOrderBy {
    return value === 'latest' || value === 'oldest' || value === 'popular'
}

/** 话题 slug 形态：小写字母、数字与连字符，直接拼进上游路径 */
const STOCK_TOPIC_ID_PATTERN = /^[a-z0-9-]{2,64}$/u

/** 话题标识是否合法：不合法的一律按「推荐」处理，不阻断整页 */
export function isStockTopicId(value: unknown): value is string {
    return typeof value === 'string' && STOCK_TOPIC_ID_PATTERN.test(value)
}

/** 图片尺寸档位：与 Unsplash urls 的四档一一对应 */
export type StockPhotoSizeKey = 'raw' | 'full' | 'regular' | 'small'

/** 尺寸是否合法：非法值按「未指定」处理，回到默认下载口径 */
export function isStockPhotoSizeKey(value: unknown): value is StockPhotoSizeKey {
    return value === 'raw' || value === 'full' || value === 'regular' || value === 'small'
}

/** 可选尺寸：宽高按原图比例折算，前端只用于展示与回传档位 */
export interface StockPhotoSize {
    key: StockPhotoSizeKey
    label: string
    width: number
    height: number
}

/** 搜索结果条目：缩略图已由宿主本地化，前端直接渲染 */
export interface StockPhoto {
    /** Unsplash 照片 id，也是插入时唯一凭据 */
    id: string
    /** 本地缩略图地址：null 表示取缩略图失败，卡片显示占位 */
    thumbUrl: string | null
    width: number
    height: number
    /** 画面描述：alt_description 优先，空串表示上游没有描述 */
    alt: string
    /** 摄影者署名：Unsplash 条款要求展示 */
    photographer: string
    /** 摄影者主页：带 utm 参数跳转 */
    photographerUrl: string
    /** 可用尺寸档位：只列上游真实给出的档，按从大到小排列 */
    sizes: readonly StockPhotoSize[]
    /** 已在本地库中：插入时不发网络、不耗配额 */
    downloaded: boolean
}

/** 已下载条目：数据源是磁盘，url 直接可用 */
export interface StockLocalPhoto {
    /** photoId，也是文件名主干 */
    id: string
    /** 存储根相对路径：unsplash/202611/Kq2WnB6x9eA.jpg */
    path: string
    /** 本地文件经宿主签发，仅本次会话有效 */
    url: string
    ext: string
    byteSize: number
    /** 年月：YYYY-MM，本地时区 */
    month: string
    width: number | null
    height: number | null
    alt: string
    /** 手工放入 unsplash/ 的文件没有署名 */
    photographer: string | null
    downloadedAt: string
    /** 首次插入时所在文档的类型，仅展示 */
    scope: MediaScope
    /** 索引有记录但磁盘文件已不在 */
    missing: boolean
}

/** 年月聚合：已下载列表的下拉选项与分组头共用 */
export interface StockMonthCount {
    /** YYYY-MM */
    month: string
    count: number
}

/** 当前编辑器决定的插入目标提示：只用于页头展示，不参与路径生成 */
export interface StockTargetHint {
    scope: MediaScope
    /** 展示用目录：unsplash/202611 */
    dirPath: string
    /** 展示用文档标题：文章首个一级标题或文件名 */
    label: string
}

/** 状态回执：密钥、配额、冷却与已下载总数 */
export interface StockStatusResult {
    configured: boolean
    /** 密钥尾号，形如 ****3f2a */
    secretHint: string | null
    /** 剩余调用次数：取本地窗口与服务端剩余中更小者，未知为 null */
    remaining: number | null
    /** 限流冷却截止时刻（ISO），null 表示未冷却 */
    cooldownUntil: string | null
    downloadedCount: number
    target: StockTargetHint | null
}

/** 密钥保存结果 */
export interface StockKeySaveResult {
    configured: boolean
    secretHint: string | null
}

/** 密钥清除结果 */
export interface StockKeyClearResult {
    configured: false
}

/** 搜索入参：page 从 1 起，query 为空表示浏览最新 */
export interface StockSearchRequest {
    query?: string
    page: number
    orientation?: StockOrientation
    /** 话题 slug：给出时浏览该话题，query 与 orientation 不参与 */
    topic?: string | null
    /** 浏览流排序：不给则尊重上游默认（/photos 为 latest，话题流为 position） */
    orderBy?: StockOrderBy | null
}

/** 搜索结果 */
export interface StockSearchResult {
    items: StockPhoto[]
    page: number
    totalPages: number
    total: number
    hasMore: boolean
    remaining: number | null
}

/** 已下载列表入参：month 缺省或非法值时按全部处理 */
export interface StockDownloadedRequest {
    month?: string | null
}

/** 已下载列表结果 */
export interface StockDownloadedResult {
    items: StockLocalPhoto[]
    months: StockMonthCount[]
    total: number
}

/** 插入失败原因：四态沿用媒体库口径，其余为本模块新增 */
export type StockInsertReason = 'no-editor' | 'unsaved' | 'not-markdown' | 'download' | 'write' | 'not-configured'

/** 插入结果 */
export interface StockInsertResult {
    inserted: boolean
    reason?: StockInsertReason
    /** 存储根相对路径：unsplash/202611/Kq2WnB6x9eA.jpg */
    path?: string
    /** 写进正文的引用：@zhai/unsplash/202611/Kq2WnB6x9eA.jpg */
    refPath?: string
    /** webview 可访问的本地地址 */
    url?: string
    /** local 表示命中本库未发网络，remote 表示本次下载 */
    source?: 'local' | 'remote'
    /** true 表示该文档已引用过这张图 */
    duplicated?: boolean
}

/** 复制图片结果：与媒体库同一套剪贴板口径，reason 区分平台不支持与执行失败 */
export interface StockCopyResult {
    copied: boolean
    reason?: 'unsupported' | 'failed'
}

/** 缩略图补取结果 */
export interface StockThumbResult {
    thumbUrl: string | null
}

/** 删除结果 */
export interface StockRemoveResult {
    removed: boolean
}
