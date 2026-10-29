/**
 * 媒体模块常量：索引库位置、批量上限与扫描范围，供索引、列举与协议层共用一份。
 * 复用约定：图片根目录名统一取 @shared/types/media 的 MEDIA_DIR，本文件不再重复定义；
 * 索引库与图片同处存储根，换机、备份与换根一并带走，避免元数据与文件脱节。
 * 关键约束：索引目录名与库文件名是跨文件契约，改名等于索引重建——历史出处与出图参数将不可恢复；
 * 扫描范围只覆盖作品文档与笔记，外部文档的引用只在插入时登记，不做全盘扫描。
 */

/** 索引目录：与 images 平级，只放数据库文件，不参与媒体扫描 */
export const MEDIA_INDEX_DIR = 'sqlite'
/** 索引库文件名 */
export const MEDIA_DB_FILE = 'media.db'

/** 单次批量删除上限：防止一次请求占用过久，也避免前端误传超大数组 */
export const MAX_BATCH_DELETE = 500

/** 作品文档中需要扫描引用与封面的文件名 */
export const PRESS_SCANNED_FILES: readonly string[] = [
    'README.md',
    '设定.md',
    '角色设定.md',
    '世界观.md',
    '金手指.md',
    '势力.md',
    '地点.md',
    '物品.md',
    '大纲.md',
]
