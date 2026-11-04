/**
 * 在线图库服务：搜索、缩略图、插入、密钥与状态，是 stock/* 协议的唯一实现入口。
 * 复用约定：HTTP 走 ./client，照片元数据留 ./cache，本地库读写走 ./stockLibraryService，
 * 密钥存取走 common/secrets（SecretStorage），路径拼接走 common/storagePath，正文写入与媒体库同一套口径。
 * 关键约束：前端只传 photoId，下载地址与保存目录一律在宿主解析；命中本地库时全程不发网络、不耗配额；
 * 目标解析前置——没有可用编辑器时直接返回四态，不做任何下载；
 * 写盘先落 .part 再 rename，失败清掉临时文件；同一时刻只允许一个下载插入任务。
 */
import * as vscode from 'vscode'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { SecretsService } from '@modules/common/secrets'
import { buildStorageUri, isPathExisting } from '@modules/common/storagePath'
import { isStockFileStem, isStockOrderBy, isStockOrientation, isStockTopicId } from '@shared/types/stock'
import type {
    StockDownloadedResult,
    StockOrderBy,
    StockInsertResult,
    StockKeyClearResult,
    StockKeySaveResult,
    StockPhoto,
    StockRemoveResult,
    StockSearchResult,
    StockStatusResult,
    StockThumbResult,
} from '@shared/types/stock'
import { pruneThumbs, readFreshThumb, writeThumb } from './cache'
import { FALLBACK_IMAGE_WIDTH, MAX_ACCESS_KEY_LENGTH, MIN_ACCESS_KEY_LENGTH } from './constants'
import { insertStockPhoto } from './repository'
import { buildStockTarget, toStockRefPath } from './stockNaming'
import { resolveStockTarget } from './stockTargetService'
import type { CachedStockPhoto, StockPhotoCache } from './cache'
import type { StockClient } from './client'
import type { StockDatabase } from './db/connection'
import type { StockLibraryService } from './stockLibraryService'
import type { StockInsertTarget } from './stockTargetService'

/** 关键词长度上限：超长查询对上游没有收益，按截断处理 */
const MAX_QUERY_LENGTH = 100
/** 页码上限：Unsplash 深翻页会返回 422，超过按边界处理 */
const MAX_PAGE = 100
/** 缩略图并发数：再高对首屏没有帮助，只会挤占带宽 */
const THUMB_CONCURRENCY = 4
/** 缩略图请求宽度：卡片在侧栏里只有百来像素，400 足够清晰 */
const THUMB_WIDTH = 400
/** 密钥尾号展示保留位数 */
const SECRET_HINT_TAIL = 4

/** 服务依赖：客户端、缓存、本地库与密钥分别注入，便于单测替换 */
export interface StockServiceDeps {
    client: StockClient
    cache: StockPhotoCache
    library: StockLibraryService
    secrets: SecretsService
    openDatabase: () => StockDatabase
}

/** 入参收窄：非对象一律拒绝 */
function readPayload(payload: unknown, method: string): Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    return payload as Record<string, unknown>
}

/** 关键词：剔除控制字符、去首尾空白，超长截断 */
function readQuery(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }
    // 逐码点过滤而不是写控制字符正则：正则里的控制字符既难读，也会被 lint 拦下
    const cleaned = [...value]
        .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
        .join('')
    return cleaned.trim().slice(0, MAX_QUERY_LENGTH)
}

/** 页码：非法值按 1 处理，越界夹到上限 */
function readPage(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.min(Math.max(Math.floor(value), 1), MAX_PAGE)
}

/** 话题 slug：非法值按「推荐」处理，不做二次清洗——形态校验已由 isStockTopicId 兜住 */
function readTopic(value: unknown): string | null {
    return isStockTopicId(value) ? value : null
}

/** 排序：非法值按「默认」处理——上游各自默认（/photos 为 latest，话题流为 position） */
function readOrderBy(value: unknown): StockOrderBy | null {
    return isStockOrderBy(value) ? value : null
}

/** 密钥掩码：只回尾 4 位，过短时整体打码 */
function maskSecret(secret: string): string {
    if (secret.length <= SECRET_HINT_TAIL * 2) {
        return '****'
    }
    return `****${secret.slice(-SECRET_HINT_TAIL)}`
}

/** 密钥格式：20–64 位字母数字串，空值与怪字符一律拒绝 */
function readAccessKey(payload: unknown): string {
    const value = readPayload(payload, 'stock/key/save').accessKey
    if (typeof value !== 'string') {
        throw new Error('请填写 Unsplash Access Key')
    }
    const trimmed = value.trim()
    if (trimmed.length < MIN_ACCESS_KEY_LENGTH || trimmed.length > MAX_ACCESS_KEY_LENGTH) {
        throw new Error('Access Key 长度不正确，请从 Unsplash 应用后台复制完整密钥')
    }
    if (!/^[A-Za-z0-9_-]+$/u.test(trimmed)) {
        throw new Error('Access Key 含非法字符，请重新复制')
    }
    return trimmed
}

/** alt 文本清洗：去掉方括号与换行，避免破坏 Markdown 语法 */
function sanitizeAlt(value: string): string {
    return value.replace(/[[\]\r\n]+/gu, ' ').trim()
}

/** 拼装片段：描述 + 可选摄影者署名 */
function buildSnippet(alt: string, photographer: string | null, refPath: string): string {
    const credit = getZhaiConfig().stockAppendCredit && photographer !== null ? ` · ${photographer}` : ''
    return `![${sanitizeAlt(`${alt.length === 0 ? '图片' : alt}${credit}`)}](${refPath})`
}

export class StockService {
    /** 进行中的下载插入：一次只允许一个，避免连点触发重复下载 */
    private activeInsert: string | null = null

    public constructor(private readonly deps: StockServiceDeps) {}

    /** 状态：密钥、配额、冷却、已下载总数与当前插入目标 */
    public async status(): Promise<StockStatusResult> {
        const secret = await this.deps.secrets.get('unsplashAccessKey')
        const snapshot = this.deps.client.getSnapshot()
        const outcome = resolveStockTarget()
        return {
            configured: secret !== undefined && secret.length > 0,
            secretHint: secret === undefined ? null : maskSecret(secret),
            remaining: snapshot.remaining,
            cooldownUntil: snapshot.cooldownUntil,
            downloadedCount: this.deps.library.count(),
            target: outcome.ok
                ? { scope: outcome.target.scope, dirPath: outcome.target.dirPath, label: outcome.target.label }
                : null,
        }
    }

    /**
     * 保存密钥：先落 SecretStorage，再用一次真实请求验证；验证失败回滚到原值。
     * 关键约束：不做格式之外的前置猜测——只有上游认可才算配置成功；
     * 回滚是为了不让一个无效密钥长期占位，否则用户下次进来会以为已配置好。
     */
    public async keySave(payload: unknown): Promise<StockKeySaveResult> {
        const accessKey = readAccessKey(payload)
        const previous = await this.deps.secrets.get('unsplashAccessKey')
        await this.deps.secrets.set('unsplashAccessKey', accessKey)
        try {
            await this.deps.client.search({ query: '', page: 1, orientation: null, topic: null, orderBy: null })
        } catch (error) {
            if (previous === undefined) {
                await this.deps.secrets.remove('unsplashAccessKey')
            } else {
                await this.deps.secrets.set('unsplashAccessKey', previous)
            }
            throw error
        }
        this.deps.client.reset()
        return { configured: true, secretHint: maskSecret(accessKey) }
    }

    /** 清除密钥：同时重置本地限流状态，避免残留冷却阻断下一次配置 */
    public async keyClear(): Promise<StockKeyClearResult> {
        await this.deps.secrets.remove('unsplashAccessKey')
        this.deps.client.reset()
        return { configured: false }
    }

    /**
     * 搜索：查询 → 缓存元数据 → 本地化缩略图 → 标记是否已下载。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async search(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<StockSearchResult> {
        const body = readPayload(payload, 'stock/search')
        // 话题与关键词互斥：话题端点不支持 query，方向筛选也不在其参数表里，一并让位
        const topic = readTopic(body.topic)
        const query = topic === null ? readQuery(body.query) : ''
        const page = readPage(body.page)
        const orientation = topic === null && isStockOrientation(body.orientation) ? body.orientation : null
        // 排序只对浏览流有意义，关键词搜索端点不接受 order_by（client 侧忽略）
        const orderBy = readOrderBy(body.orderBy)
        const result = await this.deps.client.search({ query, page, orientation, topic, orderBy })
        for (const photo of result.photos) {
            this.deps.cache.set(photo)
        }
        const items: StockPhoto[] = []
        // 分批并发：缩略图是整页最慢的一步，串行会让首屏等上好几秒
        for (let index = 0; index < result.photos.length; index += THUMB_CONCURRENCY) {
            const batch = result.photos.slice(index, index + THUMB_CONCURRENCY)
            const mapped = await Promise.all(
                batch.map(async (photo): Promise<StockPhoto> => {
                    const row = this.deps.library.find(photo.id)
                    return {
                        id: photo.id,
                        thumbUrl: await this.ensureThumb(photo, toWebviewUri),
                        width: photo.width,
                        height: photo.height,
                        alt: photo.alt,
                        photographer: photo.photographer,
                        photographerUrl: photo.photographerUrl,
                        downloaded: row !== null && !row.missing,
                    }
                }),
            )
            items.push(...mapped)
        }
        // 顺带清理过期缩略图：失败不影响本次搜索
        void pruneThumbs(resolveStorageRoot())
        return {
            items,
            page,
            totalPages: result.totalPages,
            total: result.total,
            hasMore: page < result.totalPages && items.length > 0,
            remaining: this.deps.client.getSnapshot().remaining,
        }
    }

    /** 补取单张缩略图：搜索结果里 thumbUrl 为 null 时由前端触发 */
    public async thumb(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<StockThumbResult> {
        const value = readPayload(payload, 'stock/thumb').id
        if (!isStockFileStem(value)) {
            throw new Error('stock/thumb 缺少合法的图片标识')
        }
        const cached = this.deps.cache.get(value)
        const photo = cached ?? (await this.deps.client.photo(value))
        this.deps.cache.set(photo)
        return { thumbUrl: await this.ensureThumb(photo, toWebviewUri) }
    }

    /** 已下载列表：直接转发本地库服务，协议层保持薄 */
    public downloaded(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<StockDownloadedResult> {
        return this.deps.library.list(payload, toWebviewUri)
    }

    /** 删除已下载图片：先删文件再删记录，回执只带是否成功 */
    public async remove(payload: unknown): Promise<StockRemoveResult> {
        return this.deps.library.remove(payload)
    }

    /**
     * 插入到当前编辑器光标处。
     * 关键约束：目标解析在最前面——没有可用编辑器时不下载、不扣配额；
     * 命中本地库的记录沿用原路径（月份不随当前时间漂移），未命中才按当前时间新建目录；
     * 下载成功但写入失败时文件保留，回执带原因，用户重试不会再下一遍。
     */
    public async insert(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<StockInsertResult> {
        const photoId = readPayload(payload, 'stock/insert').id
        if (!isStockFileStem(photoId)) {
            throw new Error('stock/insert 缺少合法的图片标识')
        }
        const outcome = resolveStockTarget()
        if (!outcome.ok) {
            return { inserted: false, reason: outcome.reason }
        }
        if (this.activeInsert !== null) {
            throw new Error('正在处理上一张图片，请稍候')
        }
        this.activeInsert = photoId
        try {
            return await this.insertOnce(photoId, outcome.target, toWebviewUri)
        } finally {
            this.activeInsert = null
        }
    }

    /** 缩略图：命中缓存直接用，未命中下载并写盘；单张失败返回 null 不抛错 */
    private async ensureThumb(
        photo: CachedStockPhoto,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<string | null> {
        const root = resolveStorageRoot()
        const fresh = await readFreshThumb(root, photo.id)
        if (fresh !== null) {
            return toWebviewUri(fresh)
        }
        if (photo.smallUrl === null) {
            return null
        }
        try {
            const downloaded = await this.deps.client.download(photo.smallUrl, THUMB_WIDTH)
            const written = await writeThumb(root, photo.id, downloaded.bytes)
            return toWebviewUri(written)
        } catch (error) {
            logger.warn(`缩略图获取失败：${photo.id}（${error instanceof Error ? error.message : String(error)}）`)
            return null
        }
    }

    /** 单次插入：本地复用优先，其次缓存与回源，最后下载落盘并写入正文 */
    private async insertOnce(
        photoId: string,
        target: StockInsertTarget,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<StockInsertResult> {
        const root = resolveStorageRoot()
        const local = this.deps.library.find(photoId)
        if (local !== null && (await isPathExisting(buildStorageUri(root, local.path.split('/'))))) {
            return this.writeIntoEditor(target, local.path, toWebviewUri, 'local', local.alt, local.photographer)
        }
        const photo = await this.resolvePhoto(photoId)
        const downloaded = await this.downloadWithFallback(photo)
        // 库内有记录但文件已丢：沿用原路径重建，保证同一张图的路径稳定
        const relPath = local === null ? buildStockTarget(root, photoId, downloaded.extension).relPath : local.path
        const segments = relPath.split('/')
        const dirUri = buildStorageUri(root, segments.slice(0, -1))
        const targetUri = buildStorageUri(root, segments)
        if (!(await isPathExisting(targetUri))) {
            try {
                await vscode.workspace.fs.createDirectory(dirUri)
                const tempUri = buildStorageUri(root, [...segments.slice(0, -1), `${photoId}.part`])
                await vscode.workspace.fs.writeFile(tempUri, downloaded.bytes)
                await vscode.workspace.fs.rename(tempUri, targetUri, { overwrite: false })
            } catch (error) {
                logger.error(`在线图库写盘失败：${relPath}`, error)
                return { inserted: false, reason: 'write', path: relPath }
            }
        }
        insertStockPhoto(this.deps.openDatabase().db, {
            photoId,
            path: relPath,
            ext: downloaded.extension,
            byteSize: downloaded.byteSize,
            width: photo.width,
            height: photo.height,
            alt: photo.alt,
            photographer: photo.photographer,
            photographerUrl: photo.photographerUrl,
            downloadLocation: photo.downloadLocation,
            scope: target.scope,
            downloadedAt: new Date().toISOString(),
        })
        if (photo.downloadLocation !== null) {
            void this.deps.client.trackDownload(photo.downloadLocation)
        }
        return this.writeIntoEditor(target, relPath, toWebviewUri, 'remote', photo.alt, photo.photographer)
    }

    /** 取照片元数据：内存缓存 → 回源；回源要求满足上游 id 形态 */
    private async resolvePhoto(photoId: string): Promise<CachedStockPhoto> {
        const cached = this.deps.cache.get(photoId)
        if (cached !== null) {
            return cached
        }
        const photo = await this.deps.client.photo(photoId)
        this.deps.cache.set(photo)
        return photo
    }

    /** 下载：超过体积上限时降档重下一次，仍超限则拒绝 */
    private async downloadWithFallback(
        photo: CachedStockPhoto,
    ): Promise<{ bytes: Uint8Array; extension: string; byteSize: number }> {
        const config = getZhaiConfig()
        const maxBytes = config.stockMaxBytes * 1024 * 1024
        const first = await this.deps.client.download(photo.downloadUrl, config.stockImageWidth)
        if (first.byteSize <= maxBytes) {
            return first
        }
        logger.warn(`图片超过体积上限，降档重试：${photo.id}（${String(first.byteSize)} 字节）`)
        const fallback = await this.deps.client.download(photo.downloadUrl, FALLBACK_IMAGE_WIDTH)
        if (fallback.byteSize > maxBytes) {
            throw new Error(`图片超过 ${String(config.stockMaxBytes)}MB 上限，未下载`)
        }
        return fallback
    }

    /** 写入正文：插入片段 → 聚焦选区 → 判定本次是否重复引用 */
    private async writeIntoEditor(
        target: StockInsertTarget,
        relPath: string,
        toWebviewUri: (uri: vscode.Uri) => string,
        source: 'local' | 'remote',
        alt: string,
        photographer: string | null,
    ): Promise<StockInsertResult> {
        const refPath = toStockRefPath(relPath)
        const snippet = buildSnippet(alt, photographer, refPath)
        const editor = target.editor
        const document = editor.document
        const isDuplicated = document.getText().includes(refPath)
        const insertAt = editor.selection.active
        const didInsert = await editor.edit((builder) => {
            builder.insert(insertAt, snippet)
        })
        if (!didInsert) {
            return { inserted: false, reason: 'write', path: relPath, refPath, source }
        }
        const range = new vscode.Range(insertAt, insertAt.translate(0, snippet.length))
        await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: range })
        return {
            inserted: true,
            path: relPath,
            refPath,
            url: toWebviewUri(buildStorageUri(resolveStorageRoot(), relPath.split('/'))),
            source,
            duplicated: isDuplicated,
        }
    }
}
