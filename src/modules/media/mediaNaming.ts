/**
 * 媒体命名：为待落盘的图片生成「年月目录 + 14 位时间戳 + 6 位随机段」的标识，供出图与导入共用。
 * 复用约定：合法性由 @shared/types/media 的 isMediaId 校验，目录与扩展名由调用方给出；
 * 路径一律经 common/storagePath 构造，时间戳与目录名由同一次计算产出，不会跨秒错位。
 * 关键约束：永不覆盖已有文件——同秒冲突先换随机段，换满再按秒顺延，上限内仍冲突即报错；
 * 时间戳为本地时区，与用户在文件管理器里看到的时间一致，年月目录也按本地时区归集。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { buildStorageUri } from '@modules/common/storagePath'
import { MEDIA_DIR } from '@shared/types/media'

/** 年月目录与文件名共用的时间戳位数：YYYYMMDDHHmmss */
const STAMP_LENGTH = 14
/** 随机段长度：6 位字母数字 */
const RANDOM_LENGTH = 6
/** 随机段字母表 */
const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** 同秒随机段重试次数 */
const MAX_RANDOM_RETRY = 5
/** 时间戳顺延上限：60 秒足以覆盖任何同秒冲突，再长说明命名链路异常 */
const MAX_SECOND_SHIFT = 60

/** 落盘目标：id 与年月由同一次计算产出，调用方据此拼路径 */
interface MediaTarget {
    /** 媒体 id：文件名主干 */
    id: string
    /** 年月：YYYY-MM */
    month: string
    /** 年月目录：YYYYMM */
    monthDir: string
    /** 目标目录 Uri：{root}/images/{YYYYMM} */
    dirUri: vscode.Uri
}

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

/** 6 位字母数字随机段：仅用于同秒去重，不是安全场景 */
function randomSegment(): string {
    let result = ''
    for (let index = 0; index < RANDOM_LENGTH; index += 1) {
        result += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)] ?? '0'
    }
    return result
}

/** 判断目标文件是否已存在：存在则换随机段，避免覆盖用户已有图片 */
async function isFileExisting(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}

/** 由时间戳派生年月：stamp 前 6 位即 YYYYMM */
function toMonth(stamp: string): { month: string; monthDir: string } {
    const monthDir = stamp.slice(0, 6)
    return { month: `${monthDir.slice(0, 4)}-${monthDir.slice(4, 6)}`, monthDir }
}

/**
 * 生成不冲突的落盘目标。
 * @param root 存储根 Uri
 * @param extension 不带点的扩展名，用于探测同名文件
 * @param at 落盘时刻，缺省为当前时间；测试可注入固定值
 */
export async function nextMediaTarget(
    root: vscode.Uri,
    extension: string,
    at: Date = new Date(),
): Promise<MediaTarget> {
    const normalized = extension.replace(/^\./u, '').toLowerCase()
    for (let shift = 0; shift < MAX_SECOND_SHIFT; shift += 1) {
        const date = new Date(at.getTime() + shift * 1000)
        const stamp = formatStamp(date)
        if (stamp.length !== STAMP_LENGTH) {
            continue
        }
        const { month, monthDir } = toMonth(stamp)
        const dirUri = buildStorageUri(root, [MEDIA_DIR, monthDir])
        for (let retry = 0; retry < MAX_RANDOM_RETRY; retry += 1) {
            const id = `${stamp}${randomSegment()}`
            if (!(await isFileExisting(vscode.Uri.joinPath(dirUri, `${id}.${normalized}`)))) {
                return { id, month, monthDir, dirUri }
            }
        }
    }
    throw new Error('图片命名冲突过多，请稍后重试')
}

/** 媒体相对路径：images/{YYYYMM}/{id}.{ext} */
export function toMediaPath(monthDir: string, id: string, extension: string): string {
    return path.posix.join(MEDIA_DIR, monthDir, `${id}.${extension.replace(/^\./u, '').toLowerCase()}`)
}
