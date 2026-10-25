/**
 * 生图模块常量：落盘目录名与图像配额键，供封面服务、角色卡服务与封面仓储共用一份。
 * 复用约定：目录名决定作品目录下的落盘位置，配额键决定 press.db meta 表的计数口径，
 * 各处一律从此文件取值，不再就地重复定义。
 * 关键约束：二者都是跨文件契约——改目录名须同步迁移旧文件，改键名等于清空当日额度；
 * 封面与角色卡共用同一组配额键，避免同一份额度被两处各算一次。
 */
import type { QuotaKeys } from '../common/db/quotaRepository'

/** 作品封面落盘目录：位于作品目录之下（press/{作品名}/Cover） */
export const COVER_DIR = 'Cover'

/** 角色设定图落盘目录：位于作品目录之下（press/{作品名}/Portraits） */
export const PORTRAIT_DIR = 'Portraits'

/** 图像配额键：封面与角色卡共用同一每日额度 */
export const IMAGE_QUOTA_KEYS: QuotaKeys = { dateKey: 'press_image_date', countKey: 'press_image_count' }
