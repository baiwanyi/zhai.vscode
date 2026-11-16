/**
 * 仪表盘展示层纯函数：字数的紧凑展示、批量动作的结果文案。
 * 供 press、wechat 等页面的 utils 与组件复用，不做任何宿主请求，也不依赖 UI 库。
 * 关键约束：字数口径统一在此（万位保留一位小数），避免各页面各写一套格式化；
 * 批量结果文案只在该有的分支产出，成功条数为 0 时不产出成功文案、失败为空时不产出失败文案。
 */

/** 「万」的换算基数，超过该值改用万位展示 */
const TEN_THOUSAND = 10_000

/** 字数紧凑展示：不足一万原样输出，过万折算「万」并保留一位小数（去掉多余的 .0） */
export function formatWordCount(value: number): string {
    if (value < TEN_THOUSAND) {
        return String(value)
    }
    const wan = value / TEN_THOUSAND
    return `${wan >= 100 ? Math.round(wan) : Number(wan.toFixed(1))} 万`
}

/** 批量操作的失败提示：只报条数与首条原因，避免提示被逐条刷屏 */
export function formatBatchFailure(action: string, failures: readonly { message: string }[]): string {
    return `${String(failures.length)} 项${action}失败：${failures[0]?.message ?? '未知原因'}`
}

export interface BatchOutcomeOptions {
    /** 成功文案：入参是真正生效的条数 */
    successText: (count: number) => string
    /** 实际生效条数：0 表示没有成功项，不产出成功文案 */
    count: number
    failures: readonly { message: string }[]
    /** 失败提示里的动作词，如「恢复」「清除」 */
    failureAction: string
}

export interface BatchOutcome {
    /** 成功提示文案：无成功项时为 null */
    success: string | null
    /** 失败提示文案：无失败项时为 null */
    failure: string | null
}

/** 批量操作结果文案：只在该有的分支产出文案，由调用方分别提示 */
export function readBatchOutcome(options: BatchOutcomeOptions): BatchOutcome {
    return {
        success: options.count > 0 ? options.successText(options.count) : null,
        failure: options.failures.length > 0 ? formatBatchFailure(options.failureAction, options.failures) : null,
    }
}
