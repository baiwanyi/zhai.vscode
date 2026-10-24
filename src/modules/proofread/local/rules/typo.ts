/**
 * 内置词表规则：在内置错别字对照表上做子串扫描，命中即给出一键替换建议。
 * 复用约定：词表来自 ../data/typoWords，规则层只负责定位与产出，不判断上下文。
 * 关键约束：同一词条在文中多次出现须逐处命中，用 indexOf 递增而非一次性 matchAll；
 * 判定完全依赖词表，词表之外的错字交由 AI 与自定义词库处理。
 */
import type { LocalHit } from '../localTypes'
import { TYPO_WORD_PAIRS } from '../data/typoWords'

/** 内置词表检查 */
export function checkTypoWords(text: string): LocalHit[] {
    const hits: LocalHit[] = []
    for (const [wrong, right] of TYPO_WORD_PAIRS) {
        let index = text.indexOf(wrong)
        while (index >= 0) {
            hits.push({
                category: 'typo',
                severity: 'low',
                start: index,
                end: index + wrong.length,
                quote: wrong,
                replacement: right,
                reason: `疑似错别字：应写作「${right}」`,
                ruleId: 'typo-word',
            })
            index = text.indexOf(wrong, index + wrong.length)
        }
    }
    return hits
}
