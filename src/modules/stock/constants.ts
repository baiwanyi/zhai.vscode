/**
 * 在线图库常量：索引库位置、缩略图缓存、命名口径、体积与限流参数，供客户端、仓储与页面共用一份。
 * 复用约定：图片目录名取 @shared/types/stock 的 STOCK_DIR，本文件不再重复定义；
 * 索引目录名与媒体库同级（sqlite），库文件随存储根迁移，换根后按对账重建。
 * 关键约束：缩略图目录以点开头，已下载扫描必须跳过它，否则缓存会被当成用户资产；
 * 时间窗口与上限是跨文件契约，改这里等于改界面提示的口径，需同步 docs/modules/stock.md。
 */

/** 索引目录：与媒体库的 sqlite 同级，只放数据库文件 */
export const STOCK_INDEX_DIR = 'sqlite'
/** 索引库文件名 */
export const STOCK_DB_FILE = 'stock.db'
/** 缩略图缓存目录：位于 unsplash/ 下，以点开头以便扫描跳过 */
export const STOCK_THUMB_DIR = '.thumbs'

/** 列表缓存文件名：位于存储根下，与 unsplash/ 目录平级，按页存浏览流与话题流的照片元数据 */
export const STOCK_LIST_CACHE_FILE = 'unsplash.json'
/**
 * 单页缓存有效期：按页计时，首页与后续页同一口径。
 * 超过后该页下次访问回源重取；页面内的 8 小时定时刷新只针对当前列表的首页。
 */
export const STOCK_LIST_TTL_MS = 8 * 60 * 60 * 1000
/**
 * 每个列表最多缓存的页数：与前端续载上限（5 页）对齐，超出后不再追加。
 * 每页条数取 zhai.stock.perPage（默认 20），5 页累计约 100 条。
 */
export const STOCK_LIST_MAX_PAGES = 5
/** 列表缓存条目上限：按最近一次同步时刻淘汰最旧的，避免话题与排序组合把文件撑大 */
export const STOCK_LIST_MAX_ENTRIES = 24

/** 图片扩展名白名单：与媒体库扫描口径一致 */
export const STOCK_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/** 单图体积上限（MB）：超出后降档重下一次，仍超限则拒绝 */
export const MAX_IMAGE_MB = 50

/** 搜索接口超时：Query 类接口都在秒级返回 */
export const SEARCH_TIMEOUT_MS = 15_000
/** 图片下载超时：单张可达数 MB，比查询放宽但必须有上限 */
export const DOWNLOAD_TIMEOUT_MS = 30_000
/** 基础重试次数：不含首次尝试 */
export const MAX_RETRY = 3

/** 限流窗口长度：Unsplash 按小时计，本地与之对齐 */
export const RATE_WINDOW_MS = 60 * 60 * 1000

/**
 * 缩略图缓存上限条数与存活时长。
 * 关键约束：上限要容得下多个列表缓存——每个列表 100 张，按 12 个话题留量；
 * 上限偏小时，同步新列表会把刚缓存列表的缩略图挤掉，切回去只能重新下载一遍。
 */
export const THUMB_MAX_FILES = 1200
export const THUMB_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 内存照片元数据缓存：容量与存活时长 */
export const PHOTO_CACHE_MAX = 500
export const PHOTO_CACHE_TTL_MS = 10 * 60 * 1000

/** 单页条数上限：Unsplash 的 per_page 最大 30 */
export const MAX_PER_PAGE = 30
/** 单页条数下限：低于此值一屏放不满，失去分页意义 */
export const MIN_PER_PAGE = 6

/** 体积降档时的宽度：首次超限后改用这一档重下 */
export const FALLBACK_IMAGE_WIDTH = 1080
/** 落盘宽度下限与上限：过小糊、过大白耗带宽 */
export const MIN_IMAGE_WIDTH = 800
export const MAX_IMAGE_WIDTH = 3840

/** 密钥长度区间：Unsplash Access Key 为 43 位左右的字母数字串 */
export const MIN_ACCESS_KEY_LENGTH = 20
export const MAX_ACCESS_KEY_LENGTH = 64
