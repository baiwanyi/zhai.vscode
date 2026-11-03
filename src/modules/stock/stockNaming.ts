/**
 * 在线图库命名：把 photoId 折算成「年月目录 + 上游文件名」的落盘目标，供下载与列表共用。
 * 复用约定：目录一律经 common/storagePath 构造，相对路径统一用正斜杠，扩展名由下载响应的 content-type 决定；
 * 文件名沿用 Unsplash 的下载名（{photoId}.{ext}），宿主不生成时间戳与随机段。
 * 关键约束：photoId 必须是 [A-Za-z0-9_-]，它直接参与路径拼装，非法值一律拒绝而不是清洗；
 * 年月按首次下载时刻的本地时区，同一张图复用时不移动、不按当前时间重算。
 */
import * as path from 'node:path'
import { buildStorageUri } from '@modules/common/storagePath'
import { STOCK_DIR, isStockPhotoId } from '@shared/types/stock'
import { STOCK_EXTENSIONS } from './constants'
import type * as vscode from 'vscode'

/** 落盘目标：目录与文件名由同一次计算产出 */
export interface StockTarget {
    /** 文件名主干，即 photoId */
    id: string
    /** 年月：YYYY-MM，本地时区 */
    month: string
    /** 年月目录：YYYYMM */
    monthDir: string
    /** 目标目录 Uri：{root}/unsplash/{YYYYMM} */
    dirUri: vscode.Uri
    /** 文件名：{photoId}.{ext} */
    fileName: string
    /** 存储根相对路径：unsplash/{YYYYMM}/{photoId}.{ext} */
    relPath: string
}

/** 补齐两位 */
function pad(value: number): string {
    return String(value).padStart(2, '0')
}

/** 年月目录：YYYYMM，按本地时区 */
export function formatMonthDir(at: Date): string {
    return `${String(at.getFullYear())}${pad(at.getMonth() + 1)}`
}

/** 年月：YYYY-MM，与目录同源 */
function toMonth(monthDir: string): string {
    return `${monthDir.slice(0, 4)}-${monthDir.slice(4, 6)}`
}

/**
 * 扩展名归一：去点、小写，不在白名单内的一律回落 jpg。
 * CDN 偶尔会给 image/jpeg 之外的格式，落盘名必须与实际类型一致，否则预览与推送都会认错。
 */
export function normalizeStockExtension(extension: string): string {
    const normalized = extension.replace(/^\./u, '').toLowerCase()
    const aliases: Readonly<Record<string, string>> = { jpeg: 'jpg' }
    const mapped = aliases[normalized] ?? normalized
    return STOCK_EXTENSIONS.includes(mapped) ? mapped : 'jpg'
}

/**
 * 生成落盘目标。
 * @param root 存储根 Uri
 * @param photoId Unsplash 照片 id
 * @param extension 下载响应的扩展名，不带点
 * @param at 落盘时刻，缺省为当前时间
 */
export function buildStockTarget(
    root: vscode.Uri,
    photoId: string,
    extension: string,
    at: Date = new Date(),
): StockTarget {
    if (!isStockPhotoId(photoId)) {
        throw new Error('图片标识非法')
    }
    const ext = normalizeStockExtension(extension)
    const monthDir = formatMonthDir(at)
    const fileName = `${photoId}.${ext}`
    return {
        id: photoId,
        month: toMonth(monthDir),
        monthDir,
        dirUri: buildStorageUri(root, [STOCK_DIR, monthDir]),
        fileName,
        relPath: path.posix.join(STOCK_DIR, monthDir, fileName),
    }
}

/**
 * 从存储根相对路径取年月。
 * 关键约束：必须落在 unsplash/{YYYYMM}/{文件} 三层内——媒体库的 images/ 路径同样有三层，
 * 只校验层级不校验前缀会把别人的图算进本库。
 */
export function readStockMonth(relPath: string): string | null {
    const segments = relPath.split('/')
    if (segments.length !== 3 || segments[0] !== STOCK_DIR) {
        return null
    }
    const monthDir = segments[1] ?? ''
    if (!/^\d{6}$/u.test(monthDir)) {
        return null
    }
    return toMonth(monthDir)
}

/** 正文引用：@zhai/ + 存储根相对路径 */
export function toStockRefPath(relPath: string): string {
    return `@zhai/${relPath}`
}
