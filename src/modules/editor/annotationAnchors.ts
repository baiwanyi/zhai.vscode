/**
 * 标注锚点校正：文档内容变化后，用最新块结构重新算出每条标注的位置。
 * 复用约定：写回统一交给 annotationRepository.relocateAnnotations（单事务），本文件只负责算；
 * 块文本从块 html 剥标签得到，与渲染层的 quote 定位口径一致。
 * 关键约束：先按原 blockIndex 找，找不到再全文扫描**唯一**命中；两处都失败才置 orphaned，
 * 且绝不删除记录——标注无法从 Markdown 重建，误删就是永久丢失。
 * 多处命中时不猜（保持原位），因为猜错会把标注挂到无关段落上。
 */
import type { EditorBlock } from '@shared/types/editor'
import { listAnnotationsByDoc, relocateAnnotations } from './annotationRepository'
import type { AnnotationRelocation } from './annotationRepository'
import type Database from 'better-sqlite3'

/** 块 html 转纯文本：去标签 + 还原常见实体，够用于 indexOf 定位 */
function readBlockText(html: string): string {
    return html
        .replace(/<[^>]*>/gu, '')
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&quot;/gu, '"')
        .replace(/&#39;/gu, "'")
        .replace(/&amp;/gu, '&')
}

/** 块文本快照上限：与写入标注时一致，避免整段超长文本进库 */
const MAX_BLOCK_TEXT = 1000

/**
 * 校正某文档的全部标注锚点，返回实际更新条数。
 * 文档没有标注时直接返回 0，不做任何查询以外的开销。
 */
export function relocateDocumentAnnotations(
    db: Database.Database,
    docPath: string,
    blocks: readonly EditorBlock[],
): number {
    const records = listAnnotationsByDoc(db, docPath)
    if (records.length === 0 || blocks.length === 0) {
        return 0
    }
    const blockTexts = blocks.map((block) => readBlockText(block.html))
    const items: AnnotationRelocation[] = []

    for (const record of records) {
        const quote = record.quote
        let matchedIndex = -1
        let offsetInBlock = -1

        if (quote.length > 0) {
            const sameBlock = blockTexts[record.blockIndex] ?? ''
            const inSameBlock = sameBlock.indexOf(quote)
            if (inSameBlock >= 0) {
                matchedIndex = record.blockIndex
                offsetInBlock = inSameBlock
            } else {
                const hits = blockTexts
                    .map((text, index) => ({ index, at: text.indexOf(quote) }))
                    .filter((hit) => hit.at >= 0)
                // 只有唯一命中才敢迁移，多处命中说明原文已不可判定
                if (hits.length === 1 && hits[0] !== undefined) {
                    matchedIndex = hits[0].index
                    offsetInBlock = hits[0].at
                }
            }
        }

        const block = matchedIndex >= 0 ? blocks[matchedIndex] : undefined
        if (matchedIndex < 0 || offsetInBlock < 0 || block === undefined) {
            if (!record.orphaned) {
                items.push({
                    id: record.id,
                    startOffset: record.startOffset,
                    endOffset: record.endOffset,
                    blockIndex: record.blockIndex,
                    blockHash: record.blockHash,
                    blockText: record.blockText,
                    orphaned: true,
                })
            }
            continue
        }

        const text = blockTexts[matchedIndex] ?? ''
        const isSamePlace =
            record.blockIndex === matchedIndex && record.startOffset === block.start + offsetInBlock && !record.orphaned
        if (isSamePlace) {
            continue
        }
        items.push({
            id: record.id,
            startOffset: block.start + offsetInBlock,
            endOffset: block.start + offsetInBlock + quote.length,
            blockIndex: matchedIndex,
            // 块哈希保持原值：它只是兜底锚点，重算会让历史标注与旧快照对不上
            blockHash: record.blockHash,
            blockText: text.slice(0, MAX_BLOCK_TEXT),
            orphaned: false,
        })
    }

    return relocateAnnotations(db, docPath, items)
}
