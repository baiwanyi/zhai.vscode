/**
 * AI 使用量页展示格式化：请求 id 与模块标签。
 * 复用约定：时间 / token / 耗时 / 积分折算、错误文案、剪贴板写入统一来自 @shared/utils 的 format / error / clipboard，
 * 本文件只保留账单页特有的格式化，并用别名转发，调用点无需改动。
 * 关键约束：积分未知（null）一律显示破折号，不得回退成 0.00，否则会把未知成本显示成零消耗（实现见 formatCredits）；
 * 请求 id 在表格中只截短展示，完整值通过 title 与弹窗标题给出。
 */
import { AI_USAGE_MODULE_LABELS } from '@shared/types/aiUsage'
import type { AiUsageModule } from '@shared/types/aiUsage'

// 时间 / token / 耗时折算、错误文案、剪贴板写入已上移到 @shared/utils 的 format / error / clipboard；此处转发保持账单页调用点不变
export { copyToClipboard as copyPrompt } from '@shared/utils/clipboard'
export { toErrorText } from '@shared/utils/error'
export { formatCredits, formatDateTime as formatUsageTime, formatDuration, formatTokens } from '@shared/utils/format'

/** 请求 id 在表格中的展示长度 */
const SHORT_ID_LENGTH = 8

/** 请求 id 短版：只截前 8 位，尾部加省略号 */
export function shortRequestId(requestId: string): string {
    return requestId.length <= SHORT_ID_LENGTH ? requestId : `${requestId.slice(0, SHORT_ID_LENGTH)}…`
}

/** 模块标签：未登记的键回落到对话，与宿主归一规则一致 */
export function readModuleLabel(module: AiUsageModule): string {
    return AI_USAGE_MODULE_LABELS[module]
}
