/**
 * 忽略区间收集：标出 Markdown 围栏代码块与行内代码所占的字符区间，供规则层跳过。
 * 复用约定：区间以 [start, end) 表示、按升序返回，聚合层用 isRangeIgnored 判定命中是否落在其内。
 * 关键约束：围栏未闭合时一直忽略到文末，避免半截代码块被当成正文逐行报错；
 * 只处理反引号与波浪号围栏，不解析嵌套结构（校对场景不需要完整 Markdown AST）。
 */

/** 字符区间：[start, end) */
export interface TextRange {
    start: number
    end: number
}

/** 围栏起始行：最多三格缩进，三个及以上反引号或波浪号 */
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/

/** 行内代码：单反引号包裹且不跨行 */
const INLINE_CODE_PATTERN = /`[^`\n]*`/g

/** 收集需要跳过检查的区间 */
export function collectIgnoredRanges(text: string): TextRange[] {
    const ranges: TextRange[] = []
    const lines = text.split('\n')
    let offset = 0
    let fence: { marker: string; start: number } | null = null
    for (const line of lines) {
        const lineEnd = offset + line.length
        const match = FENCE_PATTERN.exec(line)
        const marker = match?.[1] ?? ''
        if (fence === null) {
            if (marker.length > 0) {
                fence = { marker: marker.slice(0, 3), start: offset }
            } else {
                for (const inline of line.matchAll(INLINE_CODE_PATTERN)) {
                    const start = offset + (inline.index ?? 0)
                    ranges.push({ start, end: start + inline[0].length })
                }
            }
        } else if (marker.length > 0 && marker.startsWith(fence.marker)) {
            ranges.push({ start: fence.start, end: lineEnd })
            fence = null
        }
        offset = lineEnd + 1
    }
    if (fence !== null) {
        ranges.push({ start: fence.start, end: text.length })
    }
    return ranges
}

/** 判断区间是否被忽略（ranges 须升序且互不包含） */
export function isRangeIgnored(ranges: readonly TextRange[], start: number, end: number): boolean {
    for (const range of ranges) {
        if (range.start >= end) {
            return false
        }
        if (range.end > start) {
            return true
        }
    }
    return false
}
