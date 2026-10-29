/**
 * 生图模块常量：图像配额键，供出图服务与配额仓储共用一份。
 * 复用约定：键名决定 press.db meta 表的计数口径，各处一律从此文件取值，不再就地重复定义。
 * 关键约束：键名是跨文件契约——改名等于清空当日额度；
 * 落盘目录与文件命名统一由 @modules/media 管理，本文件不再定义图片目录。
 */
import type { QuotaKeys } from '@modules/common/db/quotaRepository'

/** 图像配额键：出图统一占用同一每日额度 */
export const IMAGE_QUOTA_KEYS: QuotaKeys = { dateKey: 'press_image_date', countKey: 'press_image_count' }
