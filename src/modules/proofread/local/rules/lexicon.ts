/**
 * 自定义纠错规则：按用户词库逐条匹配，replace 参与一键写回，flag 只提示。
 * 复用约定：词条结构取自共享契约，规则层不重复校验字段，空词条由调用方过滤。
 * 关键约束：flag 模式不产出 replacement，避免把主观用词偏好写成自动替换；
 * 错词在文中多次出现时逐处命中，用 indexOf 递增保证不漏。
 */
import type { ProofreadLexiconEntry } from '@shared/types/proofread'
import type { LocalHit } from '../localTypes'

/** 自定义词库检查 */
export function checkLexiconWords(text: string, entries: readonly ProofreadLexiconEntry[]): LocalHit[] {
    const hits: LocalHit[] = []
    for (const entry of entries) {
        const wrong = entry.wrong.trim()
        if (wrong.length === 0) {
            continue
        }
        let index = text.indexOf(wrong)
        while (index >= 0) {
            hits.push({
                category: 'custom',
                severity: entry.mode === 'replace' ? 'low' : 'medium',
                start: index,
                end: index + wrong.length,
                quote: wrong,
                replacement: entry.mode === 'replace' ? entry.right : null,
                reason: entry.note ?? `自定义纠错：建议写作「${entry.right}」`,
                ruleId: 'lexicon',
            })
            index = text.indexOf(wrong, index + wrong.length)
        }
    }
    return hits
}
