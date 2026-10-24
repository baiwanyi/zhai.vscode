/**
 * 章节摘要回填：把归纳产出的章节摘要合并进章节文档的 Frontmatter，让摘要落库并进入索引。
 * 复用约定：素材位置取自 importAnalysis 的 MATERIAL_FILE_NAMES，Frontmatter 拆解走 common/db/fileMeta，
 * 标量序列化复用 projectFactory 的同一实现，保证与新建章节的写入口径一致。
 * 关键约束：只补空——章节已有 summary 时一律跳过、不覆盖，因此无需写入前留版；
 * 章节路径由调用方从索引库取，本模块不采信前端路径；单章读写失败只计数不中断整批，
 * 编辑器里存在未保存修改的章节直接跳过，避免随后的保存把回填结果盖回去。
 */
import * as vscode from 'vscode'
import { MATERIAL_FILE_NAMES } from './importAnalysis'
import { formatFrontmatterScalar } from './projectFactory'
import type { ProjectIndexer } from './projectService'
import type { MergeChapterSummaryResult } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { splitFrontmatter } from '../common/db/fileMeta'
import { logger } from '../common/logger'
import { buildStorageUri } from '../common/storagePath'

/** 章节 Frontmatter 的摘要行：只认行首 summary，避免误改正文里的同名文字 */
const SUMMARY_LINE_PATTERN = /^summary:[ \t]*(.*)$/u

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

/**
 * 把摘要写入章节文档：仅在 Frontmatter 的 summary 为空（或缺失）时返回新内容。
 * 返回 null 表示无需改写——已有摘要、没有 Frontmatter 或摘要文本为空。
 * 只替换或追加 summary 一行，正文与其余键逐字保留（不做行尾整理，避免无谓 diff）。
 */
export function mergeChapterSummaryFrontmatter(content: string, summary: string): string | null {
    const normalized = summary.replace(/\s+/gu, ' ').trim()
    if (normalized.length === 0) {
        return null
    }
    const { frontmatter, body } = splitFrontmatter(content)
    if (frontmatter.trim().length === 0) {
        return null
    }
    let hasSummaryLine = false
    let hasSummaryValue = false
    const lines = frontmatter.split(/\r?\n/u).map((line) => {
        const matched = SUMMARY_LINE_PATTERN.exec(line)
        if (matched === null) {
            return line
        }
        hasSummaryLine = true
        hasSummaryValue = (matched[1] ?? '').trim().length > 0
        return `summary: ${formatFrontmatterScalar(normalized, false)}`
    })
    if (hasSummaryValue) {
        return null
    }
    if (!hasSummaryLine) {
        lines.push(`summary: ${formatFrontmatterScalar(normalized, false)}`)
    }
    return `---\n${lines.join('\n')}\n---${body}`
}

/** 回填入参：章节路径必须由调用方从索引库取出 */
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
        parts.push(`跳过 ${String(skipped)} 章（已有摘要或文件正在编辑）`)
    }
    if (failed > 0) {
        parts.push(`失败 ${String(failed)} 章`)
    }
    return parts.join('，')
}

/**
 * 回填章节摘要：以素材里的路径为关联键做内连接，逐章合并并重建索引。
 * 关联键选路径而非序号——用户改名或跨卷移动后序号会漂移，路径对不上就跳过，宁可漏填也不错填。
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
    const dirtyPaths = new Set(
        vscode.workspace.textDocuments.filter((document) => document.isDirty).map((document) => document.uri.fsPath),
    )
    let updated = 0
    let skipped = 0
    let failed = 0
    for (const chapterPath of options.chapterPaths) {
        const order = orderByPath.get(chapterPath)
        const summary = order === undefined ? undefined : summaryByOrder.get(order)
        if (summary === undefined) {
            continue
        }
        const uri = buildStorageUri(root, chapterPath.split('/'))
        if (dirtyPaths.has(uri.fsPath)) {
            skipped += 1
            continue
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(uri)
            const merged = mergeChapterSummaryFrontmatter(new TextDecoder('utf-8').decode(bytes), summary)
            if (merged === null) {
                skipped += 1
                continue
            }
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(merged))
            await options.indexer.indexFile(uri)
            updated += 1
        } catch (error) {
            failed += 1
            const detail = error instanceof Error ? error.message : String(error)
            logger.warn(`章节摘要回填失败：${chapterPath}（${detail}）`)
        }
    }
    // 三计数全零说明素材与当前章节没对上（改名、移动或尚未抽取）：如实说明，避免用户以为是成功空跑
    if (updated === 0 && skipped === 0 && failed === 0) {
        const message =
            options.chapterPaths.length === 0
                ? '作品内没有可回填的章节'
                : '素材里的章节与当前章节对不上（可能已改名或移动），建议先重新抽取素材'
        return { updated, skipped, failed, message }
    }
    return { updated, skipped, failed, message: buildMergeMessage(updated, skipped, failed) }
}
