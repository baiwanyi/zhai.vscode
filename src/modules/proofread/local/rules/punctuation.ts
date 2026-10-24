/**
 * 标点规则：中文语境下的半角标点、连续重复标点、省略号与破折号写法，全部可一键替换。
 * 复用约定：只产出 LocalHit，跳过代码区间的判定由 localChecker 统一处理。
 * 关键约束：半角标点仅在紧邻中文字符时判定，避免误伤英文、数字与 Markdown 语法；
 * 「……」与「——」本身合法，规则只在命中非规范写法时产出，不做配对与数量校验。
 */
import type { LocalHit } from '../localTypes'

/** 中文之后的半角标点：只认这五个高频符号，句点留给小数与英文 */
const HALF_WIDTH_PATTERN = /(?<=[\u4e00-\u9fa5])[,;:!?]/g

/** 半角到全角的替换映射 */
const HALF_WIDTH_MAP: Readonly<Record<string, string>> = {
    ',': '，',
    ';': '；',
    ':': '：',
    '!': '！',
    '?': '？',
}

/** 连续重复标点：感叹问号三连以上、句号逗号两连以上 */
const REPEATED_PATTERN = /([!?！？])\1{2,}|([。，])\2+/g

/** 冗余写法省略号：英文三点或中文句号连用 */
const ELLIPSIS_PATTERN = /\.{3,}|。{3,}/g

/** 中文之间的双连字符破折号 */
const DASH_PATTERN = /(?<=[\u4e00-\u9fa5])\s*--\s*(?=[\u4e00-\u9fa5])/g

/** 标点类检查 */
export function checkPunctuation(text: string): LocalHit[] {
    const hits: LocalHit[] = []
    for (const match of text.matchAll(HALF_WIDTH_PATTERN)) {
        const quote = match[0]
        const replacement = HALF_WIDTH_MAP[quote]
        if (replacement === undefined) {
            continue
        }
        const start = match.index ?? 0
        hits.push({
            category: 'typo',
            severity: 'low',
            start,
            end: start + quote.length,
            quote,
            replacement,
            reason: `中文语境应使用全角标点「${replacement}」`,
            ruleId: 'punct-half-width',
        })
    }
    for (const match of text.matchAll(REPEATED_PATTERN)) {
        const quote = match[0]
        const start = match.index ?? 0
        hits.push({
            category: 'typo',
            severity: 'low',
            start,
            end: start + quote.length,
            quote,
            replacement: match[1] ?? match[2] ?? quote.slice(0, 1),
            reason: '连续重复标点：保留一个即可',
            ruleId: 'punct-repeated',
        })
    }
    for (const match of text.matchAll(ELLIPSIS_PATTERN)) {
        const quote = match[0]
        const start = match.index ?? 0
        hits.push({
            category: 'typo',
            severity: 'low',
            start,
            end: start + quote.length,
            quote,
            replacement: '……',
            reason: '省略号应写作「……」',
            ruleId: 'punct-ellipsis',
        })
    }
    for (const match of text.matchAll(DASH_PATTERN)) {
        const quote = match[0]
        const start = match.index ?? 0
        hits.push({
            category: 'typo',
            severity: 'low',
            start,
            end: start + quote.length,
            quote,
            replacement: '——',
            reason: '破折号应写作「——」',
            ruleId: 'punct-dash',
        })
    }
    return hits
}
