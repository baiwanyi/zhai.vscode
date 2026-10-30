/**
 * 行级 diff：把「原文 → 新文」拆成可逐段接受的变更块（hunk），供写作模式按段写回。
 * 复用约定：本模块是纯函数，不读文件、不依赖宿主；行尾在内部统一为 LF，写回时由调用方按文档 EOL 还原。
 * 关键约束：相邻的增删合并为同一 hunk，等值行作为切分边界 —— 否则逐段接受会碎成单行，无法操作；
 * 规模超过单元格上限时退化为「整段一个 hunk」，宁可失去逐段能力也不能让面板卡死。
 */

/** 一个变更块：oldText 与 newText 至少一侧非空 */
export interface DiffHunk {
    /** 原文起始行号（1 基），仅用于展示 */
    oldStartLine: number
    /** 被替换的原文行；纯新增时为空数组 */
    oldText: string[]
    /** 替换后的新文行；纯删除时为空数组 */
    newStartLine: number
    newText: string[]
}

/** LCS 表单元格上限：约 4M 格，1000×1000 行的文档仍在可接受范围内 */
const MAX_DIFF_CELLS = 4_000_000

/** 行尾归一化：CRLF 与 CR 一律按 LF 处理，避免仅行尾不同被判成整段变更 */
function normalizeEol(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 切行：空文本视为零行，其余按 LF 切分（保留中间空行） */
function splitLines(text: string): string[] {
    if (text.length === 0) {
        return []
    }
    return normalizeEol(text).split('\n')
}

/** 构造 LCS 长度表：(n+1) × (m+1)，table[i][j] 表示 old[i..] 与 new[j..] 的最长公共前缀行数 */
function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
    const rows = oldLines.length + 1
    const columns = newLines.length + 1
    const table: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
    for (let i = oldLines.length - 1; i >= 0; i -= 1) {
        const current = table[i]
        const next = table[i + 1]
        if (current === undefined || next === undefined) {
            continue
        }
        for (let j = newLines.length - 1; j >= 0; j -= 1) {
            const isMatched = oldLines[i] === newLines[j]
            current[j] = isMatched ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, current[j + 1] ?? 0)
        }
    }
    return table
}

/**
 * 行级 diff：返回按原文顺序排列的变更块，空数组表示两段文本完全一致。
 * 关键约束：只在规模可承受时做精确比对，超限时整段返回一个 hunk。
 */
export function diffLines(oldText: string, newText: string): DiffHunk[] {
    const oldLines = splitLines(oldText)
    const newLines = splitLines(newText)
    if (oldLines.length === newLines.length && oldLines.every((line, index) => line === newLines[index])) {
        return []
    }
    if (oldLines.length * newLines.length > MAX_DIFF_CELLS) {
        return [{ oldStartLine: 1, oldText: oldLines, newStartLine: 1, newText: newLines }]
    }
    const table = buildLcsTable(oldLines, newLines)
    const hunks: DiffHunk[] = []
    let oldIndex = 0
    let newIndex = 0
    /** 当前累积的变更块：遇到等值行即收口，保证相邻增删落在同一段 */
    let current: DiffHunk | null = null
    const openHunk = (): DiffHunk => {
        current ??= { oldStartLine: oldIndex + 1, oldText: [], newStartLine: newIndex + 1, newText: [] }
        return current
    }
    const flush = (): void => {
        if (current !== null) {
            hunks.push(current)
            current = null
        }
    }
    while (oldIndex < oldLines.length && newIndex < newLines.length) {
        if (oldLines[oldIndex] === newLines[newIndex]) {
            flush()
            oldIndex += 1
            newIndex += 1
            continue
        }
        const skipOld = table[oldIndex + 1]?.[newIndex] ?? 0
        const skipNew = table[oldIndex]?.[newIndex + 1] ?? 0
        if (skipOld >= skipNew) {
            const hunk = openHunk()
            hunk.oldText.push(oldLines[oldIndex] ?? '')
            oldIndex += 1
        } else {
            const hunk = openHunk()
            hunk.newText.push(newLines[newIndex] ?? '')
            newIndex += 1
        }
    }
    while (oldIndex < oldLines.length) {
        const hunk = openHunk()
        hunk.oldText.push(oldLines[oldIndex] ?? '')
        oldIndex += 1
    }
    while (newIndex < newLines.length) {
        const hunk = openHunk()
        hunk.newText.push(newLines[newIndex] ?? '')
        newIndex += 1
    }
    flush()
    return hunks
}

/**
 * 按接受结果拼出新全文：未接受的 hunk 保留原文行，接受的替换为新文行。
 * 关键约束：accepted 越界索引一律忽略（不因单个脏值让整次写回失败）；行尾由调用方还原。
 */
export function composeAcceptedText(oldText: string, hunks: readonly DiffHunk[], accepted: readonly number[]): string {
    const acceptedSet = new Set(
        accepted.filter((index) => Number.isInteger(index) && index >= 0 && index < hunks.length),
    )
    const oldLines = splitLines(oldText)
    const lines: string[] = []
    let cursor = 0
    for (const [index, hunk] of hunks.entries()) {
        const oldStart = hunk.oldStartLine - 1
        // 未被任何 hunk 覆盖的原行原样保留
        for (let line = cursor; line < oldStart; line += 1) {
            const source = oldLines[line]
            if (source !== undefined) {
                lines.push(source)
            }
        }
        const replaced = acceptedSet.has(index) ? hunk.newText : hunk.oldText
        lines.push(...replaced)
        cursor = oldStart + hunk.oldText.length
    }
    for (let line = cursor; line < oldLines.length; line += 1) {
        const source = oldLines[line]
        if (source !== undefined) {
            lines.push(source)
        }
    }
    return lines.join('\n')
}
