/**
 * 展示层时间与数值格式化：本地年月日时分、相对时间、token 紧凑折算、耗时与积分。
 * 复用约定：均为无副作用的纯函数，仪表盘、用量账单与对话消息工具栏共用同一展示口径；
 * 相对时间基于原生 Intl，不引入日期库。
 * 关键约束：无效时间一律返回空串，由调用方决定「未知 / 从未构建」等业务文案；
 * token 折算统一保留一位小数、耗时按毫秒 / 秒 / 分秒三档展示、积分保留两位小数，避免各页精度不一致。
 */

/** 补零：时间格式化用，两位对齐 */
function pad2(value: number): string {
    return String(value).padStart(2, '0')
}

/**
 * 本地时间到分钟：`YYYY-MM-DD HH:mm`，用于用量对账与快照时间线。
 * 无效时间返回空串，由调用方决定展示「未知」还是回退原值。
 */
export function formatDateTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return ''
    }
    const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    return `${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** token 数紧凑展示：过千折算 k、过百万折算 M；用量页与对话页共用同一口径 */
export function formatTokens(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}k`
    }
    return String(value)
}

/**
 * 积分展示：保留两位小数；未知（null）返回破折号，不得回退成 0——
 * 未对账与「确实没消耗」是两种含义，账单页与对话工具栏共用同一口径。
 */
export function formatCredits(credits: number | null): string {
    return credits === null ? '—' : credits.toFixed(2)
}

/** 毫秒与秒、秒与分钟的换算基数 */
const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60_000

/**
 * 耗时展示：0 视为未知返回破折号，不足一秒用毫秒，不足一分钟用秒，更长折成「1m 47s」。
 * 用量账单与对话消息工具栏共用同一口径，秒数进位到 60 时并入分钟，不出现「1m 60s」。
 */
export function formatDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return '—'
    }
    if (durationMs < MS_PER_SECOND) {
        return `${Math.round(durationMs)}ms`
    }
    if (durationMs < MS_PER_MINUTE) {
        return `${(durationMs / MS_PER_SECOND).toFixed(1)}s`
    }
    const minutes = Math.floor(durationMs / MS_PER_MINUTE)
    const seconds = Math.round((durationMs % MS_PER_MINUTE) / MS_PER_SECOND)
    return seconds === 60 ? `${minutes + 1}m 0s` : `${minutes}m ${seconds}s`
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
