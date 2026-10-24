/**
 * 重复规则：虚词叠字误重（的的、了了）可直接替换，相邻短语重复只提示、不自动改写。
 * 复用约定：只产出 LocalHit，代码区间与忽略词的过滤交给 localChecker。
 * 关键约束：叠字只在封闭虚词/代词集合内判定，避免把「爸爸」「常常」「渐渐」等合法叠词判成错误；
 * 短语重复限定三到四字，两字重复几乎都是正常词汇，不纳入检测。
 */
import type { LocalHit } from '../localTypes'

/** 连续出现即属误重的虚词与代词 */
const DOUBLED_PATTERN =
    /(的|了|是|在|和|就|都|也|又|很|他|她|它|我|你|这|那|们|着|过|把|被|给|让|还|只|才|却|并|而|及)\1/g

/** 相邻重复的三到四字短语：如「说道说道」 */
const DUPLICATED_PHRASE_PATTERN = /([\u4e00-\u9fa5]{3,4})\1/g

/** 重复类检查 */
export function checkRepeat(text: string): LocalHit[] {
    const hits: LocalHit[] = []
    for (const match of text.matchAll(DOUBLED_PATTERN)) {
        const quote = match[0]
        const start = match.index ?? 0
        hits.push({
            category: 'typo',
            severity: 'low',
            start,
            end: start + quote.length,
            quote,
            replacement: match[1] ?? quote.slice(0, 1),
            reason: '叠字误重：保留一个即可',
            ruleId: 'repeat-doubled',
        })
    }
    for (const match of text.matchAll(DUPLICATED_PHRASE_PATTERN)) {
        const quote = match[0]
        const start = match.index ?? 0
        hits.push({
            category: 'typo',
            severity: 'medium',
            start,
            end: start + quote.length,
            quote,
            replacement: null,
            reason: '疑似重复表述：相邻两次出现同一短语，请人工确认',
            ruleId: 'repeat-phrase',
        })
    }
    return hits
}
