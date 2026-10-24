/**
 * 文本位置工具：把字符偏移换算成 1 基行号，本地规则与 AI 结果回填共用同一份实现。
 * 复用约定：先由 buildLineStarts 一次性建行首索引，再对每条命中二分查找，避免逐条切片统计；
 * 行号即校对界面展示的「第 N 段」，与正文段落概念对齐（空行也计一段，用户可见即可）。
 * 关键约束：偏移超出文本长度时返回最后一行，不抛错——上游可能因文档改动给出越界偏移。
 */

/** 行首索引：第 i 项是第 i 行的起始偏移（0 基） */
export function buildLineStarts(text: string): number[] {
    const starts: number[] = [0]
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '\n') {
            starts.push(index + 1)
        }
    }
    return starts
}

/** 二分查找偏移所在行号（1 基） */
export function toParagraph(lineStarts: readonly number[], offset: number): number {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        const start = lineStarts[mid] ?? 0
        if (start <= offset) {
            low = mid
        } else {
            high = mid - 1
        }
    }
    return low + 1
}
