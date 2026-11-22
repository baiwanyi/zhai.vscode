/**
 * 微博时间展示：同一年省掉年份，解析失败回退上游原串，主贴 / 转发 / 评论共用一套口径；
 * 另提供视频时长角标（m:ss / h:mm:ss），卡片与播放器共用。
 * 复用约定：调用方直接传归一化后的 ISO 串与上游原串，不再各自实现同年判断。
 * 关键约束：不把「当前年份」缓存在模块级——列表长期驻留跨年时会算错年份省略；
 * 时长入参单位为秒，与 @shared/utils/format 的毫秒口径不同，勿混用。
 */
import { format } from 'date-fns'

/** 时间文案：解析失败一律回退原串，保证列表至少能看到上游给出的时间 */
export function formatWeiboTime(createdAt: string, createdAtRaw: string): string {
    if (createdAt.length === 0) {
        return createdAtRaw
    }
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) {
        return createdAtRaw
    }
    const isSameYear = date.getFullYear() === new Date().getFullYear()
    return format(date, isSameYear ? 'MM-dd HH:mm' : 'yyyy-MM-dd HH:mm')
}

/** 视频时长角标：不足一小时给 m:ss，超过给 h:mm:ss；非有限数返回空串，由调用方跳过角标 */
export function formatWeiboMediaDuration(seconds: number): string {
    if (!Number.isFinite(seconds)) {
        return ''
    }
    const total = Math.max(0, Math.trunc(seconds))
    const minutes = Math.floor(total / 60)
    const rest = total % 60
    if (minutes < 60) {
        return `${String(minutes)}:${String(rest).padStart(2, '0')}`
    }
    return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
