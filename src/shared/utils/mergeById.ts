/**
 * 分页结果合并：按 id 去重后按序追加，供评论、子评论与转发列表共用。
 * 复用约定：入参只需带 id 的条目，不修改原数组，返回新数组并保持服务端顺序。
 * 关键约束：重复 id 保留先到的那条——先到的通常已在列表里，避免后页数据覆盖已渲染项。
 */
export function mergeById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
    const seen = new Set(current.map((item) => item.id))
    const merged = [...current]
    for (const item of incoming) {
        if (seen.has(item.id)) {
            continue
        }
        seen.add(item.id)
        merged.push(item)
    }
    return merged
}
