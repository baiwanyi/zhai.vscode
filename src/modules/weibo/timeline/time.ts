/**
 * 微博时间解析：把网页端的英文缩写时间收敛成 ISO 字符串，供帖子、评论与转发共用。
 * 复用约定：纯函数、无外部依赖，取数层与渲染前的归一化都直接调用，不再各自实现一套。
 * 关键约束：主格式带时区偏移，按偏移折算成 UTC；解析失败返回空串而不是抛错，
 * 单条时间异常不得阻断整页渲染。
 */

/** 英文月份 → 0 起月份：微博 created_at 固定输出英文缩写 */
const MONTH_INDEX: Readonly<Record<string, number>> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
}

/**
 * 解析微博时间：主格式形如 `Wed Nov 19 10:00:00 +0800 2026`，带时区偏移。
 * 解析失败返回空串而不是抛错——单条时间异常不该阻断整页。
 */
export function parseWeiboCreatedAt(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
        return ''
    }
    const match = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/u.exec(
        trimmed,
    )
    if (match !== null) {
        const [, monthName, day, hour, minute, second, sign, tzHour, tzMinute, year] = match
        const month = monthName === undefined ? undefined : MONTH_INDEX[monthName]
        if (
            month !== undefined &&
            day !== undefined &&
            hour !== undefined &&
            minute !== undefined &&
            second !== undefined &&
            sign !== undefined &&
            tzHour !== undefined &&
            tzMinute !== undefined &&
            year !== undefined
        ) {
            const offsetMinutes = (sign === '+' ? 1 : -1) * (Number(tzHour) * 60 + Number(tzMinute))
            const utcMs =
                Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)) -
                offsetMinutes * 60_000
            return new Date(utcMs).toISOString()
        }
    }
    const fallback = new Date(trimmed)
    return Number.isNaN(fallback.getTime()) ? '' : fallback.toISOString()
}
