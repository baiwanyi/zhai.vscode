/**
 * 生图模块常量：落盘目录名与图像配额键，供生图服务、封面服务与封面仓储共用一份。
 * 复用约定：目录名决定作品目录下的落盘位置，配额键决定 press.db meta 表的计数口径，
 * 各处一律从此文件取值，不再就地重复定义。
 * 关键约束：二者都是跨文件契约——改目录名只影响新图落盘、旧目录按只读兼容处理，改键名等于清空当日额度；
 * 出图统一走生图页，配额只有一处消耗，不按入口各算一次。
 */
import type { QuotaKeys } from '@modules/common/db/quotaRepository'

/** 统一图片目录：生图页出图的角色图与普通图都落在这里（press/{作品名}/Images） */
export const IMAGES_DIR = 'Images'

/** 旧版封面目录：仅列举读取兼容，不再写入新图，也不做文件搬移 */
export const COVER_DIR = 'Cover'

/** 旧版角色图目录：仅列举读取兼容，不再写入新图，也不做文件搬移 */
export const PORTRAIT_DIR = 'Portraits'

/** 图片目录扫描顺序：统一目录在前，旧目录兜底，保证新旧图片在同一列表里可见 */
export const IMAGE_DIR_NAMES: readonly string[] = [IMAGES_DIR, COVER_DIR, PORTRAIT_DIR]

/** 图像配额键：生图页出图共用同一每日额度 */
export const IMAGE_QUOTA_KEYS: QuotaKeys = { dateKey: 'press_image_date', countKey: 'press_image_count' }
