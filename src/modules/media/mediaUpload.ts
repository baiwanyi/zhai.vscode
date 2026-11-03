/**
 * 媒体上传：把前端提交的字节或用户选中的文件校验后落到 images/{YYYYMM}/，文件名由 mediaNaming 统一生成。
 * 复用约定：格式判定走 common/imageSniff 的魔数嗅探，命名与目录由 mediaNaming 产出，
 * 路径一律经 common/storagePath 构造；原始文件名只用于回执文案，不参与路径拼接。
 * 关键约束：单张 / 单批 / 总量三重上限，base64 先按字符集与长度粗筛再解码；
 * 落盘扩展名一律以魔数为准（扩展名可以伪造），无法识别的文件按项跳过并回报原因。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { sniffImageMime, toImageExtension } from '@modules/common/imageSniff'
import { buildStorageUri } from '@modules/common/storagePath'
import { nextMediaTarget, toMediaPath } from './mediaNaming'

/** 单批上传张数上限：与批量删除同量级的护栏，避免一次请求占用过久 */
export const MAX_UPLOAD_COUNT = 20
/** 单张图片体积上限：与参考图上限同量级，超出提示改用文件选择以外的方式处理 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
/** 单批上传总量上限：张数达标但总量过大会拖慢 webview 与宿主的消息通道 */
export const MAX_UPLOAD_TOTAL_BYTES = 40 * 1024 * 1024

/** 原始文件名长度上限：仅用于回执与错误提示 */
const MAX_NAME_LENGTH = 120
/** base64 字符集：允许尾部补位等号 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u
/** 解码前的长度粗筛余量：4/3 膨胀后允许少量空白 */
const BASE64_LENGTH_SLACK = 16

/** 上传候选：字节与原始文件名 */
export interface UploadCandidate {
    name: string
    bytes: Uint8Array
}

/** 落盘结果：媒体标识、相对路径与体积 */
export interface UploadedFile {
    id: string
    path: string
    ext: string
    month: string
    byteSize: number
    createdAt: string
}

/** 单条入参的解析结果：失败时带上文件名与原因，由调用方汇总回报 */
export type UploadParseResult =
    | { ok: true; candidate: UploadCandidate }
    | { ok: false; name: string; reason: string }

/** 读取文件名：缺失或超长时截断，仅作展示用途 */
function readName(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
        return '未命名图片'
    }
    return value.slice(0, MAX_NAME_LENGTH)
}

/** 去掉 data URL 前缀：前端可能直接提交 FileReader 的完整结果 */
function stripDataUrl(value: string): string {
    const index = value.indexOf(',')
    return index < 0 ? value : value.slice(index + 1)
}

/**
 * 解析一条上传入参：字段缺失、字符集非法、体积超限都在这里拦下。
 * 关键约束：解码后再次核对字节数，避免把长度造假的 base64 交给落盘环节。
 */
export function parseUploadItem(raw: unknown): UploadParseResult {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, name: '未命名图片', reason: '上传参数格式不正确' }
    }
    const record = raw as Record<string, unknown>
    const name = readName(record.name)
    const data = record.dataBase64
    if (typeof data !== 'string' || data.length === 0) {
        return { ok: false, name, reason: '缺少图片内容' }
    }
    const base64 = stripDataUrl(data)
    if (base64.length > (MAX_UPLOAD_BYTES * 4) / 3 + BASE64_LENGTH_SLACK) {
        return { ok: false, name, reason: `图片超过 ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限` }
    }
    if (!BASE64_PATTERN.test(base64)) {
        return { ok: false, name, reason: '图片内容不是合法的 base64' }
    }
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
    if (bytes.byteLength === 0) {
        return { ok: false, name, reason: '图片内容为空' }
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return { ok: false, name, reason: `图片超过 ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限` }
    }
    return { ok: true, candidate: { name, bytes } }
}

/**
 * 落盘一张图片：目录与文件名由 mediaNaming 一次算定，扩展名取魔数判定结果。
 * @throws 宽度无法识别或写入失败时抛出，由调用方按项跳过
 */
export async function saveUploadedImage(root: vscode.Uri, bytes: Uint8Array): Promise<UploadedFile> {
    const mime = sniffImageMime(bytes)
    if (mime === null) {
        throw new Error('无法识别的图片格式，仅支持 PNG / JPEG / WebP / GIF')
    }
    const ext = toImageExtension(mime)
    const target = await nextMediaTarget(root, ext)
    await vscode.workspace.fs.createDirectory(target.dirUri)
    const mediaPath = toMediaPath(target.monthDir, target.id, ext)
    await vscode.workspace.fs.writeFile(buildStorageUri(root, mediaPath.split('/')), bytes)
    return {
        id: target.id,
        path: mediaPath,
        ext,
        month: target.month,
        byteSize: bytes.byteLength,
        createdAt: new Date().toISOString(),
    }
}

/** 从磁盘读取候选文件：体积与存在性校验，失败时给出原因而不是抛错 */
export async function readCandidateFile(uri: vscode.Uri): Promise<UploadParseResult> {
    const name = readName(path.basename(uri.fsPath))
    try {
        const stat = await vscode.workspace.fs.stat(uri)
        if (stat.size === 0) {
            return { ok: false, name, reason: '图片内容为空' }
        }
        if (stat.size > MAX_UPLOAD_BYTES) {
            return { ok: false, name, reason: `图片超过 ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限` }
        }
        const bytes = await vscode.workspace.fs.readFile(uri)
        return { ok: true, candidate: { name, bytes } }
    } catch {
        return { ok: false, name, reason: '文件读取失败，可能已被移动或删除' }
    }
}
