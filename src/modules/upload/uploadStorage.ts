/**
 * 上传落盘与列举：把字节写进 {root}/uploads/{YYYYMM}/ 并按目录读回清单。
 * 复用约定：文件命名与目录分摊由 media/mediaNaming 产出（时间戳 + 随机段 + 冲突顺延），
 * 路径一律经 common/storagePath 构造；图片扩展名由魔数嗅探决定，与媒体库同一份判定。
 * 关键约束：文件名主体完全由宿主生成，原始文件名不进路径，避免同名覆盖与非法字符；
 * 扩展名非法或缺失时回落 bin，目录缺失视为空而不是错误（首次使用属正常）；
 * 枚举时按年月目录倒序、目录内按文件名倒序——文件名含时间戳，天然就是时间序。
 */
import * as vscode from 'vscode'
import { sniffImageMime, toImageExtension } from '@modules/common/imageSniff'
import { buildStorageUri } from '@modules/common/storagePath'
import { nextMediaTarget, parseStampTime, toDatedPath } from '@modules/media/mediaNaming'
import { UPLOAD_DIR } from '@shared/types/upload'
import type { UploadCandidate } from './uploadPayload'

/** 年月目录：6 位数字 */
const MONTH_DIR_PATTERN = /^\d{6}$/u
/** 原扩展名的合法形态：纯字母数字，长度 1–10（不接受点、空格与多段后缀） */
const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,10}$/u
/** 取不到合法扩展名时的兜底 */
const FALLBACK_EXTENSION = 'bin'

/** 已落盘文件：路径与展示字段，url 由服务层按会话签发 */
export interface StoredUploadFile {
    path: string
    name: string
    ext: string
    byteSize: number
    month: string
    /** 优先取文件名前 14 位，解析失败回落 mtime */
    createdAt: string
}

/** 从文件名取扩展名：不含点、非法字符或超长时返回 null */
function readExtension(name: string): string | null {
    const index = name.lastIndexOf('.')
    if (index <= 0 || index === name.length - 1) {
        return null
    }
    const ext = name.slice(index + 1)
    return EXTENSION_PATTERN.test(ext) ? ext.toLowerCase() : null
}

/**
 * 决定落盘扩展名：图片以魔数为准（扩展名可伪造），其余沿用原文件名后缀。
 * 关键约束：原后缀不合规时回落 bin，绝不把它拼进路径。
 */
export function resolveUploadExtension(name: string, bytes: Uint8Array): string {
    const mime = sniffImageMime(bytes)
    if (mime !== null) {
        return toImageExtension(mime)
    }
    return readExtension(name) ?? FALLBACK_EXTENSION
}

/**
 * 落盘一个文件：目录与文件名由 naming 一次算定。
 * @throws 写入失败时抛出，由调用方按项跳过并回报原因
 */
export async function saveUploadFile(root: vscode.Uri, candidate: UploadCandidate): Promise<StoredUploadFile> {
    const ext = resolveUploadExtension(candidate.name, candidate.bytes)
    const target = await nextMediaTarget(root, ext, new Date(), UPLOAD_DIR)
    await vscode.workspace.fs.createDirectory(target.dirUri)
    const relativePath = toDatedPath(UPLOAD_DIR, target.monthDir, target.id, ext)
    await vscode.workspace.fs.writeFile(buildStorageUri(root, relativePath.split('/')), candidate.bytes)
    const fileName = `${target.id}.${ext}`
    return {
        path: relativePath,
        name: fileName,
        ext,
        byteSize: candidate.bytes.byteLength,
        month: target.month,
        createdAt: new Date().toISOString(),
    }
}

/** 读取单个文件条目：stat 失败（并发删除）返回 null，不中断整次列举 */
async function readEntry(root: vscode.Uri, monthDir: string, fileName: string): Promise<StoredUploadFile | null> {
    let stat: vscode.FileStat
    try {
        stat = await vscode.workspace.fs.stat(buildStorageUri(root, [UPLOAD_DIR, monthDir, fileName]))
    } catch {
        return null
    }
    const id = fileName.replace(/\.[^.]+$/u, '')
    const month = `${monthDir.slice(0, 4)}-${monthDir.slice(4, 6)}`
    return {
        path: `${UPLOAD_DIR}/${monthDir}/${fileName}`,
        name: fileName,
        ext: readExtension(fileName) ?? FALLBACK_EXTENSION,
        byteSize: stat.size,
        month,
        createdAt: parseStampTime(id) ?? new Date(stat.mtime).toISOString(),
    }
}

/**
 * 列举上传目录下的全部文件。
 * @param root 存储根 Uri
 */
export async function listUploadFiles(root: vscode.Uri): Promise<StoredUploadFile[]> {
    let monthEntries: [string, vscode.FileType][]
    try {
        monthEntries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, [UPLOAD_DIR]))
    } catch {
        // uploads 目录尚未创建：首次使用属正常
        return []
    }
    const monthDirs = monthEntries
        .filter(([name, type]) => type === vscode.FileType.Directory && MONTH_DIR_PATTERN.test(name))
        .map(([name]) => name)
        .sort()
        .reverse()
    const result: StoredUploadFile[] = []
    for (const monthDir of monthDirs) {
        let fileEntries: [string, vscode.FileType][]
        try {
            fileEntries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, [UPLOAD_DIR, monthDir]))
        } catch {
            continue
        }
        const fileNames = fileEntries
            .filter(([, type]) => type === vscode.FileType.File)
            .map(([name]) => name)
            .sort()
            .reverse()
        for (const fileName of fileNames) {
            const entry = await readEntry(root, monthDir, fileName)
            if (entry !== null) {
                result.push(entry)
            }
        }
    }
    return result
}
