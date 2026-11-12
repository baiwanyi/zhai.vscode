/**
 * 块级差异定位：把「当前块序列」与「上一次同步的基线块」对齐，算出要替换的原文区间。
 * 复用约定：纯计算，不碰编辑器与协议；HTML 由调用方序列化，基线区间来自宿主快照的 start/end。
 * 关键约束：用最长公共子序列匹配内容未变的块，两处匹配之间的空档整体算一次替换——
 * 逐个下标对照会在插入 / 删除块时把后续块整体错位，正是插入表格后被写到错误位置的原因；
 * 纯插入的锚点取前一个基线块的 end，插到最前面取第一个基线块的 start，文档为空取 0。
 */
import type { EditorBlock, EditorBlockChange } from '@shared/types/editor'

/** 基线块：内容与它在原文中的区间 */
export interface BlockBaseline {
    html: string
    start: number
    end: number
}

/** 最长公共子序列：返回内容相同的块下标配对 [当前下标, 基线下标] */
function matchBlocks(current: readonly string[], baseline: readonly string[]): Array<[number, number]> {
    const rows = current.length
    const cols = baseline.length
    const lengths: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
    for (let row = rows - 1; row >= 0; row -= 1) {
        for (let col = cols - 1; col >= 0; col -= 1) {
            const line = lengths[row]
            const next = lengths[row + 1]
            if (line === undefined || next === undefined) {
                continue
            }
            line[col] =
                current[row] === baseline[col]
                    ? (next[col + 1] ?? 0) + 1
                    : Math.max(next[col] ?? 0, line[col + 1] ?? 0)
        }
    }
    const matches: Array<[number, number]> = []
    let row = 0
    let col = 0
    while (row < rows && col < cols) {
        if (current[row] === baseline[col]) {
            matches.push([row, col])
            row += 1
            col += 1
            continue
        }
        if ((lengths[row + 1]?.[col] ?? 0) >= (lengths[row]?.[col + 1] ?? 0)) {
            row += 1
        } else {
            col += 1
        }
    }
    return matches
}

/** 把当前块与宿主块区间配对成基线：多出的块（宿主还没写入）锚在最后一个 end 上 */
export function pairBaseline(htmls: readonly string[], blocks: readonly EditorBlock[]): BlockBaseline[] {
    const tail = blocks[blocks.length - 1]?.end ?? 0
    return htmls.map((html, index) => {
        const block = blocks[index]
        return { html, start: block?.start ?? tail, end: block?.end ?? tail }
    })
}

/** 计算区间变更：只覆盖真正变化的部分，内容未变的块不产生写入 */
export function buildBlockChanges(
    current: readonly string[],
    baseline: readonly BlockBaseline[],
): EditorBlockChange[] {
    const matches = matchBlocks(
        current,
        baseline.map((block) => block.html),
    )
    const anchors: Array<[number, number]> = [...matches, [current.length, baseline.length]]
    const changes: EditorBlockChange[] = []
    let previousCurrent = -1
    let previousBaseline = -1
    for (const [currentEnd, baselineEnd] of anchors) {
        const htmls = current.slice(previousCurrent + 1, currentEnd)
        const replaced = baseline.slice(previousBaseline + 1, baselineEnd)
        if (htmls.length > 0 || replaced.length > 0) {
            const start = replaced[0]?.start ?? baseline[previousBaseline]?.end ?? baseline[0]?.start ?? 0
            const end = replaced[replaced.length - 1]?.end ?? start
            changes.push({ start, end, htmls })
        }
        previousCurrent = currentEnd
        previousBaseline = baselineEnd
    }
    return changes
}
