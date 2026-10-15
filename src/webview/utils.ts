/**
 * Webview 展示层共享纯函数：统一的相对时间格式化。
 * 被仪表盘与 AI 对话页面同时复用，避免两处各维护一套时间展示规则。
 * 关键约束：无效时间返回空串，由调用方决定「未知 / 从未构建」等业务文案。
 */

/** 相对时间格式化器（原生 Intl，不引日期库） */
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

/** 时间展示：7 天内用相对时间，更早回退本地日期；无效时间返回空串 */
export function formatRelativeTime(iso: string): string {
    const time = new Date(iso).getTime()
    if (Number.isNaN(time)) {
        return ''
    }
    const minutes = Math.round((time - Date.now()) / 60_000)
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
    return new Date(iso).toLocaleDateString('zh-CN')
}
