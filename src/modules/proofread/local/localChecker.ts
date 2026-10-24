/**
 * 本地检查聚合：串联标点、重复、内置词表与自定义词库四组规则，统一做代码区间过滤、忽略词过滤、
 * 去重排序并补齐段落号与稳定 id，产出可直接渲染的 ProofreadIssue 列表。
 * 复用约定：规则函数来自 ./rules，忽略区间来自 ./ignoredRanges，词库来自共享契约；
 * 输出结构与宿主写回、前端展示共用同一份契约，不在本层做任何文案格式化。
 * 关键约束：命中落在围栏代码块或行内代码内直接丢弃；忽略词按命中位置前后窗口判定，
 * 避免角色名、专有名词被内置词表误报；区间完全重叠时只保留首条，防止同一位置报两种问题。
 */
import { collectIgnoredRanges, isRangeIgnored } from './ignoredRanges'
import { checkLexiconWords } from './rules/lexicon'
import { checkPunctuation } from './rules/punctuation'
import { checkRepeat } from './rules/repeat'
import { checkTypoWords } from './rules/typo'
import type { LocalHit } from './localTypes'
import type { ProofreadIssue, ProofreadLexiconEntry, ProofreadLocalResult } from '../../../shared/types/proofread'
import { buildLineStarts, toParagraph } from '../textPosition'

/** 忽略词命中窗口：命中区间前后各取若干字符再判断，覆盖跨在名字内部的误报 */
const IGNORE_WINDOW = 6

/** 命中是否被忽略词放过：只看命中附近窗口，避免整篇出现名字就全量不报 */
function isIgnoredByWord(text: string, hit: LocalHit, ignores: readonly string[]): boolean {
    if (ignores.length === 0) {
        return false
    }
    const from = Math.max(0, hit.start - IGNORE_WINDOW)
    const to = Math.min(text.length, hit.end + IGNORE_WINDOW)
    const window = text.slice(from, to)
    return ignores.some((word) => word.length > 0 && window.includes(word))
}

/** 执行本地检查 */
export function runLocalChecks(
    text: string,
    options: { entries: readonly ProofreadLexiconEntry[]; ignores: readonly string[] },
): ProofreadLocalResult {
    const startedAt = performance.now()
    const ignoredRanges = collectIgnoredRanges(text)
    const rawHits: LocalHit[] = [
        ...checkPunctuation(text),
        ...checkRepeat(text),
        ...checkTypoWords(text),
        ...checkLexiconWords(text, options.entries),
    ]
    const seen = new Set<string>()
    const lineStarts = buildLineStarts(text)
    const issues: ProofreadIssue[] = []
    let suppressed = 0
    for (const hit of rawHits) {
        if (isRangeIgnored(ignoredRanges, hit.start, hit.end)) {
            continue
        }
        if (isIgnoredByWord(text, hit, options.ignores)) {
            suppressed += 1
            continue
        }
        const key = `${String(hit.start)}:${String(hit.end)}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        issues.push({
            id: `${hit.category}-${String(hit.start)}-${String(hit.end)}`,
            category: hit.category,
            severity: hit.severity,
            quote: hit.quote,
            start: hit.start,
            end: hit.end,
            replacement: hit.replacement,
            reason: hit.reason,
            source: 'local',
            paragraph: toParagraph(lineStarts, hit.start),
        })
    }
    issues.sort((left, right) => left.start - right.start)
    return {
        issues,
        elapsedMs: Math.round(performance.now() - startedAt),
        suppressed,
        lexiconEntries: options.entries.length,
    }
}
