/**
 * 生图模块常量：落盘目录与图像配额键，供生图服务、封面服务与封面仓储共用一份。
 * 复用约定：目录名决定作品目录下的落盘位置，配额键决定 press.db meta 表的计数口径，
 * 各处一律从此文件取值，不再就地重复定义。
 * 关键约束：二者都是跨文件契约——改目录名等于让旧图全部不可见，改键名等于清空当日额度；
 * 图片只落 Images 一个目录，不再区分角色图与封面的历史目录，扫描与路径校验都以这里为准。
 */
import type { QuotaKeys } from '@modules/common/db/quotaRepository'

/** 统一图片目录：角色图与普通图都落在这里（press/{作品名}/Images） */
export const IMAGES_DIR = 'Images'

/** 图片目录集合：扫描接口按数组接收，当前只有统一目录 */
export const IMAGE_DIR_NAMES: readonly string[] = [IMAGES_DIR]

/** 图像配额键：生图页出图共用同一每日额度 */
export const IMAGE_QUOTA_KEYS: QuotaKeys = { dateKey: 'press_image_date', countKey: 'press_image_count' }
