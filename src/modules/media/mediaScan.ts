/**
 * 媒体扫描：遍历 {root}/images/{YYYYMM}/ 得到磁盘真实清单，并与索引库对账。
 * 复用约定：路径一律经 common/storagePath 构造，扩展名口径与 @shared/types/media 的 isMediaPath 同源；
 * 时间优先取文件名前 14 位（本地时间），解析失败回落文件 mtime，与列举排序口径一致。
 * 关键约束：目录缺失视为空而不是错误——首次使用、磁盘清理都属正常；
 * 手工放入的文件按 import 补录，不因命名不合规被拒；同一 id 出现两份时以先入库者为准，后者只记日志；
 * 对账只纠正 path / month / missing，绝不改写出处与出图参数。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { buildStorageUri } from '@modules/common/storagePath'
import { MEDIA_DIR } from '@shared/types/media'
import { insertMedia, listMediaPaths, markMediaMissing, updateMediaPath } from './mediaRepository'
import type { MediaDatabase } from './db/connection'
import type { ScannedMedia } from './mediaRepository'

/** 年月目录：6 位数字 */
const MONTH_DIR_PATTERN = /^\d{6}$/u
/** 图片扩展名：与 shared 口径一致 */
const EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/iu
/** 文件名主干里的 14 位时间戳 */
const TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/u

/** 由文件名前缀解析本地时间：非法日期返回 null，由调用方回落 mtime */
function parseStampTime(id: string): string | null {
    const matched = TIMESTAMP_PATTERN.exec(id)
    if (matched === null) {
        return null
    }
    const [, year, month, day, hour, minute, second] = matched
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== Number(year) ||
        date.getMonth() !== Number(month) - 1 ||
        date.getDate() !== Number(day) ||
        date.getHours() !== Number(hour)
    ) {
        return null
    }
    return date.toISOString()
}

/**
 * 扫描磁盘上的全部媒体文件。
 * @param root 存储根 Uri
 */
export async function scanMediaFiles(root: vscode.Uri): Promise<ScannedMedia[]> {
    const result: ScannedMedia[] = []
    let monthEntries: [string, vscode.FileType][]
    try {
        monthEntries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, [MEDIA_DIR]))
    } catch {
        // images 目录尚未创建：首次使用或用户未出过图
        return result
    }
    for (const [monthDir, monthType] of monthEntries) {
        if (monthType !== vscode.FileType.Directory || !MONTH_DIR_PATTERN.test(monthDir)) {
            continue
        }
        const month = `${monthDir.slice(0, 4)}-${monthDir.slice(4, 6)}`
        let fileEntries: [string, vscode.FileType][]
        try {
            fileEntries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, [MEDIA_DIR, monthDir]))
        } catch {
            continue
        }
        for (const [name, fileType] of fileEntries) {
            if (fileType !== vscode.FileType.File || !EXTENSION_PATTERN.test(name)) {
                continue
            }
            const id = name.replace(/\.[^.]+$/u, '')
            const segments = [MEDIA_DIR, monthDir, name]
            let stat: vscode.FileStat
            try {
                stat = await vscode.workspace.fs.stat(buildStorageUri(root, segments))
            } catch {
                // 并发删除：文件刚列出来就消失，跳过但不中断整次扫描
                continue
            }
            result.push({
                id,
                path: segments.join('/'),
                ext: name.split('.').pop()?.toLowerCase() ?? 'png',
                byteSize: stat.size,
                month,
                createdAt: parseStampTime(id) ?? new Date(stat.mtime).toISOString(),
            })
        }
    }
    return result
}

/** 对账结果：补录、丢失、路径纠正与跳过（id 重复）的数量 */
interface ReconcileOutcome {
    indexed: number
    missing: number
    corrected: number
    skipped: number
}

/**
 * 与索引库对账：磁盘为准。
 * 磁盘有、库里没有 → 按 import 补录；库里有、磁盘没有 → 标 missing；
 * 同一 id 换了目录 → 纠正 path 与 month；文件恢复 → 取消 missing。
 */
export function reconcileMedia(mediaDb: MediaDatabase, files: readonly ScannedMedia[]): ReconcileOutcome {
    const { db } = mediaDb
    const known = new Map(listMediaPaths(db).map((row) => [row.id, row.path]))
    const outcome: ReconcileOutcome = { indexed: 0, missing: 0, corrected: 0, skipped: 0 }
    const seen = new Set<string>()
    db.transaction(() => {
        for (const file of files) {
            if (seen.has(file.id)) {
                outcome.skipped += 1
                logger.warn(`媒体 id 重复，跳过后者：${file.path}`)
                continue
            }
            seen.add(file.id)
            const existing = known.get(file.id)
            if (existing === undefined) {
                insertMedia(db, {
                    id: file.id,
                    path: file.path,
                    ext: file.ext,
                    byteSize: file.byteSize,
                    month: file.month,
                    createdAt: file.createdAt,
                    scope: 'general',
                    origin: 'import',
                    kind: 'unknown',
                    pressPath: null,
                    pressName: null,
                    characterId: null,
                    characterName: null,
                    loreKind: null,
                    loreId: null,
                    loreName: null,
                    prompt: null,
                    ratio: null,
                    style: null,
                    enhancedFrom: null,
                })
                outcome.indexed += 1
                continue
            }
            if (existing !== file.path) {
                updateMediaPath(db, file.id, file.path, file.month)
                outcome.corrected += 1
                continue
            }
            markMediaMissing(db, file.id, false)
        }
        for (const [id] of known) {
            if (seen.has(id)) {
                continue
            }
            markMediaMissing(db, id, true)
            outcome.missing += 1
        }
    })()
    return outcome
}
