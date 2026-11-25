/**
 * 章节摘要回填：把归纳产出的章摘要写回大纲「章节内容」的「计划梗概」，不改章节正文文件。
 * 复用约定：素材位置取自 importAnalysis 的 MATERIAL_FILE_NAMES，大纲解析与写回复用 outlineSync；
 * 路径构造沿用 common/storagePath，索引重建由调用方的 ProjectIndexer 提供。
 * 关键约束：只补空——梗概已有内容时一律跳过、不覆盖；章号以素材的全局序号对齐扁平章块，
 * 对不上就跳过，宁可漏填也不错填；大纲在编辑器里有未保存修改时整批跳过，避免覆盖用户改动。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
import type { MergeChapterSummaryResult } from '@shared/types/press'
import { MATERIAL_FILE_NAMES } from './importAnalysis'
import { OUTLINE_FILE_NAME, mergeChapterSummaryIntoOutline, readOutlineChapterBlocks } from './outlineSync'
import type { ProjectIndexer } from './projectService'

/** 素材 TSV 的列分隔符 */
const TSV_SEPARATOR = '\t'

/** 序号列形态：表头首列是「序号」二字，据此判断是否需要丢弃首行 */
const ORDER_CELL_PATTERN = /^\d+$/u

/** index.tsv 中路径所在列（序号 / 卷 / 标题 / 字数 / 路径） */
const INDEX_PATH_COLUMN = 4

/**
 * 解析素材 TSV：首个非空行首列不是纯数字时视为表头丢弃，其余按 tab 切列。
 * 摘要与标题在写入时已把制表符与换行替换为空格，因此按 tab 切列不会串列。
 */
function parseMaterialRows(content: string): string[][] {
    const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0)
    const firstRow = lines[0]?.split(TSV_SEPARATOR) ?? []
    const startIndex = ORDER_CELL_PATTERN.test(firstRow[0] ?? '') ? 0 : 1
    return lines.slice(startIndex).map((line) => line.split(TSV_SEPARATOR))
}

/** 读取作品内的素材文件：文件缺失时返回 null，由调用方按「尚未生成」处理 */
async function readMaterialFile(dirPath: string, relativePath: string): Promise<string | null> {
    const segments = dirPath.split('/').filter((segment) => segment.length > 0)
    const uri = buildStorageUri(resolveStorageRoot(), [...segments, ...relativePath.split('/')])
    try {
        const bytes = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(bytes)
    } catch {
        return null
    }
}

/** 回填入参：作品目录与章路径由调用方从索引库取出 */
export interface MergeChapterSummaryOptions {
    dirPath: string
    /** 作品已登记的章节相对路径 */
    chapterPaths: readonly string[]
    indexer: ProjectIndexer
}

/** 组装面向用户的一句话结论 */
function buildMergeMessage(updated: number, skipped: number, failed: number): string {
    const parts = [`已回填 ${String(updated)} 章摘要`]
    if (skipped > 0) {
        parts.push(`跳过 ${String(skipped)} 章（已有梗概或章号对不上）`)
    }
    if (failed > 0) {
        parts.push(`失败 ${String(failed)} 章`)
    }
    return parts.join('，')
}

/**
 * 回填章节摘要：以素材里的路径取章号，按全局序号对齐大纲里的扁平章块，逐章补写梗概。
 * 关联键在素材侧仍是路径——用户改名或跨卷移动后路径对不上就跳过，避免错填到别的章。
 */
export async function mergeChapterSummaries(options: MergeChapterSummaryOptions): Promise<MergeChapterSummaryResult> {
    const summaryContent = await readMaterialFile(options.dirPath, MATERIAL_FILE_NAMES.summaries)
    const indexContent = await readMaterialFile(options.dirPath, MATERIAL_FILE_NAMES.index)
    const summaryByOrder = new Map<number, string>()
    for (const row of summaryContent === null ? [] : parseMaterialRows(summaryContent)) {
        const order = Number.parseInt(row[0] ?? '', 10)
        const summary = (row[1] ?? '').trim()
        if (Number.isNaN(order) || summary.length === 0) {
            continue
        }
        summaryByOrder.set(order, summary)
    }
    if (summaryByOrder.size === 0) {
        return { updated: 0, skipped: 0, failed: 0, message: '尚未生成章节摘要，请先完成摘要归纳' }
    }
    const orderByPath = new Map<string, number>()
    for (const row of indexContent === null ? [] : parseMaterialRows(indexContent)) {
        const order = Number.parseInt(row[0] ?? '', 10)
        const relativePath = (row[INDEX_PATH_COLUMN] ?? '').trim()
        if (Number.isNaN(order) || relativePath.length === 0) {
            continue
        }
        orderByPath.set(relativePath, order)
    }
    const root = resolveStorageRoot()
    const outlineUri = buildStorageUri(root, [...toSafeSegments(options.dirPath, '作品'), OUTLINE_FILE_NAME])
    const dirtyPaths = new Set(
        vscode.workspace.textDocuments.filter((document) => document.isDirty).map((document) => document.uri.fsPath),
    )
    if (dirtyPaths.has(outlineUri.fsPath)) {
        return { updated: 0, skipped: options.chapterPaths.length, failed: 0, message: '大纲正在编辑，请先保存后再回填' }
    }
    let outline: string
    try {
        outline = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(outlineUri))
    } catch {
        outline = ''
    }
    if (readOutlineChapterBlocks(outline).length === 0) {
        return { updated: 0, skipped: 0, failed: 0, message: '大纲里没有可回填的章纲' }
    }
    let updated = 0
    let skipped = 0
    for (const chapterPath of options.chapterPaths) {
        const order = orderByPath.get(chapterPath)
        const summary = order === undefined ? undefined : summaryByOrder.get(order)
        if (order === undefined || summary === undefined) {
            continue
        }
        const next = mergeChapterSummaryIntoOutline(outline, order, summary)
        if (next === null) {
            skipped += 1
            continue
        }
        outline = next
        updated += 1
    }
    if (updated === 0 && skipped === 0) {
        const message =
            options.chapterPaths.length === 0
                ? '作品内没有可回填的章节'
                : '素材里的章节与大纲对不上（可能已改名或移动），建议先重新抽取素材'
        return { updated, skipped, failed: 0, message }
    }
    if (updated > 0) {
        try {
            await vscode.workspace.fs.writeFile(outlineUri, new TextEncoder().encode(outline))
            await options.indexer.indexFile(outlineUri)
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            logger.warn(`大纲摘要回填失败：${options.dirPath}（${detail}）`)
            return { updated: 0, skipped, failed: updated, message: buildMergeMessage(0, skipped, updated) }
        }
    }
    return { updated, skipped, failed: 0, message: buildMergeMessage(updated, skipped, 0) }
}
