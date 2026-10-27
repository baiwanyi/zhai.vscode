/**
 * 图片命名：为待落盘的图片生成不与磁盘冲突的标识，供生图页的统一出图入口使用。
 * 复用约定：格式合法性由 shared/types/imagegen 的 isPressImageId 校验，目录与扩展名由调用方给出；
 * 冲突时只按秒顺延，不改类别与角色段，保证文件名始终可被解析回类别与归属。
 * 关键约束：永不覆盖已有文件；顺延上限内仍冲突即抛错，而不是随机改名造出无法识别的文件名；
 * 每次探测都实际 stat 磁盘，因此并发或历史残留都不会被漏掉。
 */
import * as vscode from 'vscode'
import { isPressImageId } from '@shared/types/imagegen'

/** 时间戳顺延上限：60 秒足以覆盖任何同秒冲突，再长说明该目录命名异常 */
const MAX_TIMESTAMP_SHIFT = 60
/** 随机段字母表 */
const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** 随机段长度 */
const RANDOM_LENGTH = 8

/** 图片类别：决定标识前缀，角色图额外带角色段 */
export type ImageIdKind = 'portrait' | 'photo'

/** 本地时间戳：YYYYMMDDHHmmss，按文件名即可排序 */
function formatStamp(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    return [
        String(date.getFullYear()),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('')
}

/** 8 位字母数字随机串：仅用于普通图片的文件名去重 */
function randomSuffix(): string {
    let result = ''
    for (let index = 0; index < RANDOM_LENGTH; index += 1) {
        result += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)] ?? '0'
    }
    return result
}

/** 判断文件是否已存在：用于同秒冲突时顺延时间戳 */
async function isFileExisting(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}

/** 按类别拼出标识：角色图带角色段，普通图片带随机段 */
function buildImageId(kind: ImageIdKind, stamp: string, characterId: string | null): string {
    if (kind === 'portrait') {
        return `portrait-${stamp}-${characterId ?? ''}`
    }
    return `photo-${stamp}-${randomSuffix()}`
}

/**
 * 生成不冲突的图片标识：冲突时逐秒顺延，直到找到空位。
 * @param dirUri 目标目录（需已存在）
 * @param extension 不带点的扩展名，仅用于探测同名文件
 */
export async function nextImageId(
    dirUri: vscode.Uri,
    kind: ImageIdKind,
    characterId: string | null,
    extension: string,
): Promise<string> {
    const base = Date.now()
    for (let shift = 0; shift < MAX_TIMESTAMP_SHIFT; shift += 1) {
        const id = buildImageId(kind, formatStamp(new Date(base + shift * 1000)), characterId)
        if (!isPressImageId(id)) {
            continue
        }
        if (!(await isFileExisting(vscode.Uri.joinPath(dirUri, `${id}.${extension}`)))) {
            return id
        }
    }
    throw new Error('图片命名冲突过多，请稍后重试')
}
