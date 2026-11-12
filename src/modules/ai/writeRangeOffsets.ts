/**
 * 写回范围决策：只做纯字符串运算，不依赖 vscode，因此可以单测。
 * 复用约定：规则与文本编辑器的 buildWriteRange 一致——有选区取选区、无选区取整篇；
 * 富文本只是把「编辑器选区」换成上报的 quote，因为网页侧拿不到行号。
 * 关键约束：quote 定位不到时降级为整篇（而不是报错或返回 null）——用户可能刚改过原文，
 * 此时「整篇」是可理解的默认；整篇为空或超过上限才返回 null，让调用方提示「请选中片段」，
 * 绝不能因为拿不到范围就退化成覆盖式写入。
 */

/** 写回范围决策结果：偏移以文档字符下标为准，由调用方转成 Range */
export interface WriteRangeDecision {
    start: number
    end: number
    scope: 'selection' | 'document'
    /** 给了选区但定位失败：调用方据此提示「原文已改，已改用整篇」 */
    isFallback: boolean
}

/**
 * 决定写回范围。
 * @param text 文档全文
 * @param quote 富文本上报的选区文本；空串或无选区时传 ''
 * @param maxDocumentChars 整篇写回的字符上限，与文本编辑器同一常量
 */
export function decideWriteOffsets(text: string, quote: string, maxDocumentChars: number): WriteRangeDecision | null {
    const needle = quote.trim()
    if (needle.length > 0) {
        const index = text.indexOf(needle)
        if (index >= 0) {
            return {
                start: index,
                end: index + needle.length,
                scope: 'selection',
                isFallback: false,
            }
        }
    }
    if (text.length === 0 || text.length > maxDocumentChars) {
        return null
    }
    return { start: 0, end: text.length, scope: 'document', isFallback: needle.length > 0 }
}
