/**
 * Webview 展示层共享纯函数：统一的相对时间格式化与错误提示。
 * 被仪表盘与工作流页面同时复用，避免两处各维护一套时间展示与错误文案口径。
 * 关键约束：无效时间返回空串，由调用方决定「未知 / 从未构建」等业务文案；
 * 操作类错误一律经 toastError 走 sonner 上报，调用方不再自行渲染内联错误文本。
 */
import { toast } from 'sonner'

/** 统一错误提示：宿主协议错误以 Error 抛出，其余形态兜底转字符串 */
export function toastError(cause: unknown): void {
    toast.error(cause instanceof Error ? cause.message : String(cause))
}

/** 相对时间格式化器（原生 Intl，不引日期库） */
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

/** 一分钟内视为「刚刚」的秒级阈值 */
const JUST_NOW_SECONDS = 10

/** 超出相对时间范围时的月日回退：同年省略年份，跨年带上年份 */
function formatMonthDay(date: Date): string {
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`
    const year = date.getFullYear()
    return year === new Date().getFullYear() ? monthDay : `${year}年${monthDay}`
}

/**
 * 时间展示：一分钟内精确到秒（10 秒内为「刚刚」），7 天内用相对时间，
 * 更早回退月日（如「9月18日」，跨年带年份）；无效时间返回空串
 */
export function formatRelativeTime(iso: string): string {
    const time = new Date(iso).getTime()
    if (Number.isNaN(time)) {
        return ''
    }
    const seconds = Math.round((time - Date.now()) / 1000)
    if (Math.abs(seconds) < 60) {
        return Math.abs(seconds) < JUST_NOW_SECONDS ? '刚刚' : RELATIVE_TIME_FORMATTER.format(seconds, 'second')
    }
    const minutes = Math.round(seconds / 60)
    if (Math.abs(minutes) < 60) {
        return RELATIVE_TIME_FORMATTER.format(minutes, 'minute')
    }
    const hours = Math.round(minutes / 60)
    if (Math.abs(hours) < 24) {
        return RELATIVE_TIME_FORMATTER.format(hours, 'hour')
    }
    const days = Math.round(hours / 24)
    if (Math.abs(days) < 7) {
        return RELATIVE_TIME_FORMATTER.format(days, 'day')
    }
    return formatMonthDay(new Date(iso))
}
