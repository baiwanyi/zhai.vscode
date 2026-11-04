/**
 * 在线图库缓存：搜索结果的照片元数据留在内存，缩略图落到 unsplash/.thumbs 供 webview 直接加载。
 * 复用约定：内存缓存只存「重复插入需要的东西」（下载地址、计数端点、署名），列表展示字段不在此重复；
 * 缩略图经 workspace.fs 写盘，由宿主签发地址，webview 的 CSP 因此不需要为外链图放宽。
 * 关键约束：缓存条目有存活时长与容量上限，过期即视为未命中并回源一次；
 * 缩略图目录以点开头，已下载扫描必须跳过；清理按 mtime 升序，先删最旧的。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { buildStorageUri } from '@modules/common/storagePath'
import { STOCK_DIR } from '@shared/types/stock'
import { PHOTO_CACHE_MAX, PHOTO_CACHE_TTL_MS, STOCK_THUMB_DIR, THUMB_MAX_FILES, THUMB_TTL_MS } from './constants'

/** 内存中保留的照片元数据：插入时据此下载，避免为一张图再查一次详情 */
export interface CachedStockPhoto {
    id: string
    width: number
    height: number
    alt: string
    photographer: string
    photographerUrl: string
    /** 下载入口：raw 优先，缺失时由调用方回落 full / regular */
    downloadUrl: string
    /** 下载计数端点：插入成功后触发一次，Unsplash 条款要求 */
    downloadLocation: string | null
    /** 缩略图源地址：用于补取缩略图 */
    smallUrl: string | null
}

/** 带时间戳的缓存条目 */
interface CacheEntry {
    photo: CachedStockPhoto
    storedAt: number
}

/**
 * 照片元数据缓存：容量上限内按插入顺序淘汰最旧一条。
 * 不做 LRU——图库是「搜完就插」的短链路，访问顺序与插入顺序基本一致。
 */
export class StockPhotoCache {
    private readonly entries = new Map<string, CacheEntry>()

    /** 写入一条：已达上限时先淘汰最早插入的条目 */
    public set(photo: CachedStockPhoto): void {
        this.entries.set(photo.id, { photo, storedAt: Date.now() })
        while (this.entries.size > PHOTO_CACHE_MAX) {
            const oldest = this.entries.keys().next()
            if (oldest.done === true) {
                break
            }
            this.entries.delete(oldest.value)
        }
    }

    /** 读取一条：过期按未命中处理并顺手清掉 */
    public get(photoId: string): CachedStockPhoto | null {
        const entry = this.entries.get(photoId)
        if (entry === undefined) {
            return null
        }
        if (Date.now() - entry.storedAt > PHOTO_CACHE_TTL_MS) {
            this.entries.delete(photoId)
            return null
        }
        return entry.photo
    }

    /** 清空：存储根切换或密钥变更后调用 */
    public clear(): void {
        this.entries.clear()
    }
}

/** 缩略图目录 Uri：{root}/unsplash/.thumbs */
export function resolveThumbDir(root: vscode.Uri): vscode.Uri {
    return buildStorageUri(root, [STOCK_DIR, STOCK_THUMB_DIR])
}

/** 缩略图 Uri：按 photoId 定名，扩展名固定 jpg（Unsplash 的 small 尺寸即 jpeg） */
export function resolveThumbUri(root: vscode.Uri, photoId: string): vscode.Uri {
    return vscode.Uri.joinPath(resolveThumbDir(root), `${photoId}.jpg`)
}

/** 读取未过期的缩略图：不存在或超过存活时长返回 null，由调用方决定是否重新下载 */
export async function readFreshThumb(root: vscode.Uri, photoId: string): Promise<vscode.Uri | null> {
    const uri = resolveThumbUri(root, photoId)
    try {
        const stat = await vscode.workspace.fs.stat(uri)
        return Date.now() - stat.mtime > THUMB_TTL_MS ? null : uri
    } catch {
        return null
    }
}

/** 写入缩略图：目录不存在先创建，覆盖旧文件（同名即同一张图） */
export async function writeThumb(root: vscode.Uri, photoId: string, bytes: Uint8Array): Promise<vscode.Uri> {
    const dir = resolveThumbDir(root)
    await vscode.workspace.fs.createDirectory(dir)
    const uri = resolveThumbUri(root, photoId)
    await vscode.workspace.fs.writeFile(uri, bytes)
    return uri
}

/**
 * 清理缩略图缓存：删掉超过存活时长的，再按数量上限从旧到新删。
 * 失败不抛错——缓存清理失败不影响任何功能。
 */
export async function pruneThumbs(root: vscode.Uri): Promise<void> {
    const dir = resolveThumbDir(root)
    let entries: [string, vscode.FileType][]
    try {
        entries = await vscode.workspace.fs.readDirectory(dir)
    } catch {
        return
    }
    const now = Date.now()
    const candidates: { uri: vscode.Uri; mtime: number }[] = []
    for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) {
            continue
        }
        const uri = vscode.Uri.joinPath(dir, name)
        try {
            const stat = await vscode.workspace.fs.stat(uri)
            if (now - stat.mtime > THUMB_TTL_MS) {
                await vscode.workspace.fs.delete(uri, { useTrash: false })
                continue
            }
            candidates.push({ uri, mtime: stat.mtime })
        } catch {
            // 单个文件读不到就跳过，不影响其余条目
        }
    }
    if (candidates.length <= THUMB_MAX_FILES) {
        return
    }
    candidates.sort((left, right) => left.mtime - right.mtime)
    for (const item of candidates.slice(0, candidates.length - THUMB_MAX_FILES)) {
        try {
            await vscode.workspace.fs.delete(item.uri, { useTrash: false })
        } catch {
            // 删除失败只影响缓存体积，交给下次清理
        }
    }
}

/** 缩略图文件名主干：供调试日志拼装路径 */
export function toThumbFileName(photoId: string): string {
    return path.posix.join(STOCK_DIR, STOCK_THUMB_DIR, `${photoId}.jpg`)
}
