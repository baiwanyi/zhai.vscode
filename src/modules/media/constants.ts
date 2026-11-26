/**
 * 媒体模块常量：索引库位置与批量上限，供索引、列举与协议层共用一份。
 * 复用约定：图片根目录名统一取 @shared/types/mediaPath 的 MEDIA_DIR，本文件不再重复定义；
 * 索引库与图片同处存储根，换机、备份与换根一并带走，避免元数据与文件脱节。
 * 关键约束：索引目录名与库文件名是跨文件契约，改名等于索引重建——历史出处与出图参数将不可恢复；
 * 作品目录内的 Markdown 由引用服务整目录遍历，不在此维护按文件名的扫描白名单。
 */

/** 索引目录：与 images 平级，只放数据库文件，不参与媒体扫描 */
export const MEDIA_INDEX_DIR = 'sqlite'
/** 索引库文件名 */
export const MEDIA_DB_FILE = 'media.db'

/** 单次批量删除上限：防止一次请求占用过久，也避免前端误传超大数组 */
export const MAX_BATCH_DELETE = 500
