/**
 * 在线图库服务：搜索、缩略图、插入、密钥与状态，是 stock/* 协议的唯一实现入口。
 * 复用约定：HTTP 走 ./client，照片元数据留 ./cache，浏览流列表缓存走 ./stockListCache，
 * 本地库读写走 ./stockLibraryService，密钥存取走 common/secrets（SecretStorage），
 * 路径拼接走 common/storagePath，正文写入与媒体库同一套口径。
 * 关键约束：前端只传 photoId，下载地址与保存目录一律在宿主解析；命中本地库时全程不发网络、不耗配额；
 * 浏览流与话题流以 {存储根}/unsplash.json 为准，但只缓存实际加载过的页：首页进来只抓第 1 页，
 * 滚动续载时才抓下一页，两者共用同一套按页 8 小时过期与回源规则；
 * 同一列表同一页的并发请求合并为一次（定时器、刷新按钮与首屏不会各抓一遍）；
 * 插入可按上游原生档位（raw / full / regular / small）下载，未指定档位时用配置宽度取 raw 入口；
 * 复制与插入共用同一段落盘链，复制不依赖活动编辑器，落盘归属按 general 记账；
 * 目标解析前置——没有可用编辑器时直接返回四态，不做任何下载；
 * 写盘先落 .part 再 rename，失败清掉临时文件；同一时刻只允许一个下载插入任务。
 */
import * as vscode from 'vscode'
import { writeImageToClipboard } from '@modules/common/clipboardImage'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildBlockInsertion, readBlockContext } from '@modules/common/markdownBlock'
import type { SecretsService } from '@modules/common/secrets'
import { buildStorageUri, isPathExisting } from '@modules/common/storagePath'
import { insertIntoRichDocument } from '@modules/editor/activeDocument'
import type { MediaScope } from '@shared/types/media'
import {
    isStockFileStem,
    isStockOrderBy,
    isStockOrientation,
    isStockPhotoSizeKey,
    isStockTopicId,
} from '@shared/types/stock'
import type {
    StockCopyResult,
    StockDownloadedResult,
    StockOrderBy,
    StockOrientation,
    StockInsertResult,
    StockKeyClearResult,
    StockKeySaveResult,
    StockPhoto,
    StockPhotoSize,
    StockPhotoSizeKey,
    StockRemoveResult,
    StockSearchResult,
    StockStatusResult,
    StockThumbResult,
} from '@shared/types/stock'
import { pruneThumbs, readFreshThumb, writeThumb } from './cache'
import { StockApiError } from './client'
import { FALLBACK_IMAGE_WIDTH, MAX_ACCESS_KEY_LENGTH, MIN_ACCESS_KEY_LENGTH } from './constants'
import { insertStockPhoto } from './repository'
import {
    findCachedPage,
    findCachedPhoto,
    isStockPageUsable,
    mergeCachedPage,
    readStockListCache,
    saveStockList,
    toStockListKey,
} from './stockListCache'
import { buildStockTarget, toStockRefPath } from './stockNaming'
import { resolveStockTarget } from './stockTargetService'
import type { CachedStockPhoto, StockPhotoCache } from './cache'
import type { StockClient, StockSearchPage } from './client'
import type { StockDatabase } from './db/connection'
import type { StockLibraryService } from './stockLibraryService'
import type { StockCachedPage, StockListKeyInput } from './stockListCache'
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
/** 尺寸档位文案：与 Unsplash urls 四档一一对应 */
const SIZE_LABELS: Readonly<Record<StockPhotoSizeKey, string>> = {
    raw: '原始',
    full: '大图',
    regular: '中图',
    small: '小图',
}
/** 档位标称宽度：raw / full 保留原图宽度，regular / small 由上游裁好 */
const SIZE_WIDTHS: Readonly<Record<StockPhotoSizeKey, number>> = {
    raw: 0,
    full: 0,
    regular: 1080,
    small: 400,
}
/** 档位从大到小：超体积时沿此顺序降级 */
const SIZE_ORDER: readonly StockPhotoSizeKey[] = ['raw', 'full', 'regular', 'small']

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
    return `![${buildAltText(alt, photographer)}](${refPath})`
}

/** 图片替代文本：alt 为空时用「图片」，可选追加署名；富文本分支复用同一份文案 */
function buildAltText(alt: string, photographer: string | null): string {
    const credit = getZhaiConfig().stockAppendCredit && photographer !== null ? ` · ${photographer}` : ''
    return sanitizeAlt(`${alt.length === 0 ? '图片' : alt}${credit}`)
}

/** 默认下载入口：raw → full → regular，parsePhoto 已保证至少一档存在 */
function defaultDownloadUrl(photo: CachedStockPhoto): string {
    return photo.urls.raw ?? photo.urls.full ?? photo.urls.regular ?? ''
}

/** 从相对路径取扩展名：剪贴板按类型写入，取不到时按 jpg 处理 */
function readPathExtension(relPath: string): string {
    const index = relPath.lastIndexOf('.')
    return index < 0 ? 'jpg' : relPath.slice(index + 1).toLowerCase()
}

/** 可用尺寸：只列上游真实给出的档，宽高按原图比例折算 */
function toSizes(photo: CachedStockPhoto): StockPhotoSize[] {
    const sizes: StockPhotoSize[] = []
    for (const key of SIZE_ORDER) {
        if (photo.urls[key] === null) {
            continue
        }
        const nominal = SIZE_WIDTHS[key]
        const width = nominal === 0 ? photo.width : Math.min(nominal, photo.width)
        const height =
            photo.width > 0 && photo.height > 0 && width > 0 ? Math.round((width * photo.height) / photo.width) : 0
        sizes.push({ key, label: SIZE_LABELS[key], width, height })
    }
    return sizes
}

/** 关键词搜索入参：全部来自 readQuery / isStockOrientation / readOrderBy，不再二次收窄 */
interface StockRemoteSearchInput {
    query: string
    page: number
    orientation: StockOrientation | null
    orderBy: StockOrderBy | null
}

export class StockService {
    /** 进行中的下载插入：一次只允许一个，避免连点触发重复下载 */
    private activeInsert: string | null = null

    /**
     * 进行中的取页：按「列表键#页码」合并并发请求。
     * 关键约束：定时器、刷新按钮与首屏可能同时要同一页，不合并就会各抓一遍（每次一页一份配额）。
     */
    private readonly pendingPages = new Map<string, Promise<StockCachedPage>>()

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
     * 搜索入口：关键词走远端分页（不落盘），浏览流与话题流按页走 {存储根}/unsplash.json 缓存。
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
        // 关键词组合无穷，不落盘：只有浏览流与话题流有资格吃缓存、省配额
        if (query.length > 0) {
            return this.searchRemote({ query, page, orientation, orderBy }, toWebviewUri)
        }
        // refresh 只由「更多 - 刷新」与 8 小时定时器置为 true；只对首页有意义，续载页照常按页缓存
        const isForced = body.refresh === true && page === 1
        return this.browsePage({ topic, orientation, orderBy }, page, isForced, toWebviewUri)
    }

    /** 补取单张缩略图：搜索结果里 thumbUrl 为 null 时由前端触发 */
    public async thumb(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<StockThumbResult> {
        const value = readPayload(payload, 'stock/thumb').id
        if (!isStockFileStem(value)) {
            throw new Error('stock/thumb 缺少合法的图片标识')
        }
        const photo = await this.resolvePhoto(value)
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
        const body = readPayload(payload, 'stock/insert')
        const photoId = body.id
        if (!isStockFileStem(photoId)) {
            throw new Error('stock/insert 缺少合法的图片标识')
        }
        // 尺寸档位可省略：省略时按配置宽度下载 raw 入口，等价于「默认尺寸」
        const size = isStockPhotoSizeKey(body.size) ? body.size : undefined
        const outcome = resolveStockTarget()
        if (!outcome.ok) {
            return { inserted: false, reason: outcome.reason }
        }
        if (this.activeInsert !== null) {
            throw new Error('正在处理上一张图片，请稍候')
        }
        this.activeInsert = photoId
        try {
            return await this.insertOnce(photoId, outcome.target, toWebviewUri, size)
        } finally {
            this.activeInsert = null
        }
    }

    /**
     * 复制图片到系统剪贴板：本地有文件直接复制，没有则按默认尺寸下载落盘后再复制。
     * 关键约束：复制不依赖活动编辑器，落盘归属按 general 记账；下载与写盘复用插入链路。
     */
    public async copy(payload: unknown): Promise<StockCopyResult> {
        const photoId = readPayload(payload, 'stock/copy').id
        if (!isStockFileStem(photoId)) {
            throw new Error('stock/copy 缺少合法的图片标识')
        }
        const root = resolveStorageRoot()
        const local = this.deps.library.find(photoId)
        if (local !== null) {
            const localUri = buildStorageUri(root, local.path.split('/'))
            if (await isPathExisting(localUri)) {
                const outcome = await writeImageToClipboard(localUri.fsPath, local.ext)
                return outcome === 'copied' ? { copied: true } : { copied: false, reason: outcome }
            }
        }
        const target = resolveStockTarget()
        const scope: MediaScope = target.ok ? target.target.scope : 'general'
        const stored = await this.downloadToLibrary(photoId, undefined, scope)
        if (!stored.ok) {
            return { copied: false, reason: 'failed' }
        }
        const fileUri = buildStorageUri(root, stored.relPath.split('/'))
        const outcome = await writeImageToClipboard(fileUri.fsPath, readPathExtension(stored.relPath))
        return outcome === 'copied' ? { copied: true } : { copied: false, reason: outcome }
    }

    /**
     * 关键词搜索：保持远端分页语义，不落盘——关键词组合无穷，缓存文件会被撑爆且命中率极低。
     * 关键约束：结果仍写入内存元数据缓存，插入时不必再回源取下载地址。
     */
    private async searchRemote(
        input: StockRemoteSearchInput,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<StockSearchResult> {
        const result = await this.deps.client.search({
            query: input.query,
            page: input.page,
            orientation: input.orientation,
            topic: null,
            orderBy: input.orderBy,
        })
        for (const photo of result.photos) {
            this.deps.cache.set(photo)
        }
        const items = await this.toStockItems(result.photos, toWebviewUri)
        // 顺带清理过期缩略图：失败不影响本次搜索
        void pruneThumbs(resolveStorageRoot())
        return {
            items,
            page: input.page,
            totalPages: result.totalPages,
            total: result.total,
            hasMore: input.page < result.totalPages && items.length > 0,
            remaining: this.deps.client.getSnapshot().remaining,
            fromCache: false,
            syncedAt: null,
        }
    }

    /**
     * 浏览流与话题流的一页：该页未过期就直接本地化，否则只回源这一页并写回。
     * 关键约束：首页与续载页走完全相同的规则——首屏只抓第 1 页，滚动到第 N 页才抓第 N 页，
     * 缓存里只有真正看过的页；命中缓存仍要重新签发缩略图地址，但不发任何接口请求。
     */
    private async browsePage(
        input: StockListKeyInput,
        page: number,
        isForced: boolean,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<StockSearchResult> {
        const root = resolveStorageRoot()
        const key = toStockListKey(input)
        if (!isForced) {
            const cachedFile = await readStockListCache(root)
            const cached = findCachedPage(cachedFile.lists[key], page)
            if (cached !== null && isStockPageUsable(cached, getZhaiConfig().stockPerPage)) {
                return this.toPageResult(cached, true, toWebviewUri)
            }
        }
        try {
            const fetched = await this.fetchPage(root, key, input, page)
            return this.toPageResult(fetched, false, toWebviewUri)
        } catch (error) {
            // 把列表标识与页码带进文案：同一句「限流 / 404」在页面上要能看出是哪一页出的问题
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`在线图库取页失败：${key} 第 ${String(page)} 页（${message}）`)
            throw new Error(`${message}（列表：${key} 第 ${String(page)} 页）`, { cause: error })
        }
    }

    /** 缓存页 → 协议回执：本地化缩略图后交给页面，分页信息随页回传，前端据此决定是否继续续载 */
    private async toPageResult(
        page: StockCachedPage,
        isFromCache: boolean,
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<StockSearchResult> {
        return {
            items: await this.toStockItems(page.photos, toWebviewUri),
            page: page.page,
            totalPages: page.totalPages,
            total: page.total,
            hasMore: page.hasMore,
            remaining: this.deps.client.getSnapshot().remaining,
            fromCache: isFromCache,
            syncedAt: page.syncedAt,
        }
    }

    /**
     * 取一页并落盘：同一「列表键 + 页码」同一时刻只跑一次。
     * 关键约束：8 小时定时刷新、刷新按钮与首屏可能同时要同一页，不合并就会各抓一遍；
     * 合并只针对同一页，续载下一页是另一件事，不会互相等待。
     */
    private async fetchPage(
        root: vscode.Uri,
        key: string,
        input: StockListKeyInput,
        page: number,
    ): Promise<StockCachedPage> {
        const pendingKey = `${key}#${String(page)}`
        const pending = this.pendingPages.get(pendingKey)
        if (pending !== undefined) {
            return pending
        }
        const task = this.fetchPageOnce(root, key, input, page).finally(() => {
            this.pendingPages.delete(pendingKey)
        })
        this.pendingPages.set(pendingKey, task)
        return task
    }

    /**
     * 单页回源：抓一页、进内存缓存、并入磁盘缓存。
     * 关键约束：页与页之间按页覆盖——重抓第 N 页时第 N+1 页起的旧页一并作废（分页顺序可能已变）；
     * 缓存写失败只记日志，本次结果照常返回，下次访问再补写。
     */
    private async fetchPageOnce(
        root: vscode.Uri,
        key: string,
        input: StockListKeyInput,
        page: number,
    ): Promise<StockCachedPage> {
        const result = await this.requestPage(input, page, false)
        const cachedPage: StockCachedPage = {
            page,
            photos: result.photos,
            syncedAt: new Date().toISOString(),
            perPage: getZhaiConfig().stockPerPage,
            // 浏览流没有总页数（client 按「本页有内容就还有下一页」估），空页即到底
            hasMore: page < result.totalPages && result.photos.length > 0,
            totalPages: result.totalPages,
            total: result.total,
        }
        for (const photo of result.photos) {
            this.deps.cache.set(photo)
        }
        try {
            const current = (await readStockListCache(root)).lists[key]
            await saveStockList(root, mergeCachedPage(current, input, cachedPage))
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`在线图库列表缓存写入失败：${key} 第 ${String(page)} 页（${message}）`)
        }
        void pruneThumbs(root)
        return cachedPage
    }

    /**
     * 单页请求：话题首页 404（上游下线该 slug）时改用 slug 作关键词搜一次。
     * 关键约束：只对 404 降级，限流、网络与权限问题照旧抛出，不做无谓的二次消耗。
     */
    private async requestPage(input: StockListKeyInput, page: number, isFallback: boolean): Promise<StockSearchPage> {
        try {
            return await this.searchOnce(input, page, isFallback)
        } catch (error) {
            const topic = input.topic
            const canFallback =
                !isFallback && topic !== null && error instanceof StockApiError && error.code === 'not-found'
            if (!canFallback) {
                throw error
            }
            logger.warn(`在线图库话题已不可用，改为关键词搜索：${topic}`)
            return this.searchOnce(input, page, true)
        }
    }

    /** 实际请求：常规走话题流或浏览流，降级时把 slug 拆成关键词走后一页同一口径 */
    private async searchOnce(input: StockListKeyInput, page: number, isFallback: boolean): Promise<StockSearchPage> {
        const topic = input.topic
        if (isFallback && topic !== null) {
            return this.deps.client.search({
                // slug 是连字符形态，当关键词用时拆成词更贴近搜索意图
                query: topic.replace(/-/gu, ' '),
                page,
                orientation: null,
                topic: null,
                orderBy: null,
            })
        }
        return this.deps.client.search({
            query: '',
            page,
            orientation: input.orientation,
            topic,
            orderBy: input.orderBy,
        })
    }

    /** 元数据 → 协议条目：本地化缩略图并标记是否已下载，缓存与回源两条路径共用 */
    private async toStockItems(
        photos: readonly CachedStockPhoto[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<StockPhoto[]> {
        const items: StockPhoto[] = []
        // 分批并发：缩略图是整屏最慢的一步，串行会让首屏等上好几秒
        for (let index = 0; index < photos.length; index += THUMB_CONCURRENCY) {
            const batch = photos.slice(index, index + THUMB_CONCURRENCY)
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
                        sizes: toSizes(photo),
                        downloaded: row !== null && !row.missing,
                    }
                }),
            )
            items.push(...mapped)
        }
        return items
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
        if (photo.urls.small === null) {
            return null
        }
        try {
            const downloaded = await this.deps.client.download(photo.urls.small, THUMB_WIDTH)
            const written = await writeThumb(root, photo.id, downloaded.bytes)
            return toWebviewUri(written)
        } catch (error) {
            logger.warn(`缩略图获取失败：${photo.id}（${error instanceof Error ? error.message : String(error)}）`)
            return null
        }
    }

    /** 单次插入：本地复用优先，其次缓存与回源，最后按档位下载落盘并写入正文 */
    private async insertOnce(
        photoId: string,
        target: StockInsertTarget,
        toWebviewUri: (uri: vscode.Uri) => string,
        size: StockPhotoSizeKey | undefined,
    ): Promise<StockInsertResult> {
        const root = resolveStorageRoot()
        const local = this.deps.library.find(photoId)
        // 本地已有文件时不再回源：尺寸档位只决定下载内容，复用本地时一律用已落盘的那一份
        if (local !== null && (await isPathExisting(buildStorageUri(root, local.path.split('/'))))) {
            return this.writeIntoEditor(target, local.path, toWebviewUri, 'local', local.alt, local.photographer)
        }
        const stored = await this.downloadToLibrary(photoId, size, target.scope)
        if (!stored.ok) {
            return { inserted: false, reason: 'write', path: stored.relPath }
        }
        return this.writeIntoEditor(
            target,
            stored.relPath,
            toWebviewUri,
            'remote',
            stored.photo.alt,
            stored.photo.photographer,
        )
    }

    /**
     * 下载并落盘一张图：库内已有记录时沿用原路径，未记录才按当前时间新建目录。
     * 关键约束：先落 .part 再 rename，写盘失败回传 relPath 供前端提示，不抛错；
     * 下载与入库是插入与复制共用的同一段，避免两条链路各写一份。
     */
    private async downloadToLibrary(
        photoId: string,
        size: StockPhotoSizeKey | undefined,
        scope: MediaScope,
    ): Promise<{ ok: true; relPath: string; photo: CachedStockPhoto } | { ok: false; relPath: string }> {
        const root = resolveStorageRoot()
        const local = this.deps.library.find(photoId)
        const photo = await this.resolvePhoto(photoId)
        const downloaded = await this.downloadForSize(photo, size)
        // 库内有记录但文件已丢：沿用原路径重建，保证同一张图的路径稳定
        const relPath = local === null ? buildStockTarget(root, photoId, downloaded.extension).relPath : local.path
        const segments = relPath.split('/')
        const targetUri = buildStorageUri(root, segments)
        if (!(await isPathExisting(targetUri))) {
            try {
                await vscode.workspace.fs.createDirectory(buildStorageUri(root, segments.slice(0, -1)))
                const tempUri = buildStorageUri(root, [...segments.slice(0, -1), `${photoId}.part`])
                await vscode.workspace.fs.writeFile(tempUri, downloaded.bytes)
                await vscode.workspace.fs.rename(tempUri, targetUri, { overwrite: false })
            } catch (error) {
                logger.error(`在线图库写盘失败：${relPath}`, error)
                return { ok: false, relPath }
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
            scope,
            downloadedAt: new Date().toISOString(),
        })
        if (photo.downloadLocation !== null) {
            void this.deps.client.trackDownload(photo.downloadLocation)
        }
        return { ok: true, relPath, photo }
    }

    /**
     * 按档位下载：给了档位就走上游原生地址，超过体积上限时沿更小的档位降级；
     * 未给档位或全部档位都不满足时回到默认宽度口径（raw 入口 + 配置宽度）。
     */
    private async downloadForSize(
        photo: CachedStockPhoto,
        size: StockPhotoSizeKey | undefined,
    ): Promise<{ bytes: Uint8Array; extension: string; byteSize: number }> {
        if (size === undefined) {
            return this.downloadWithFallback(photo)
        }
        const maxBytes = getZhaiConfig().stockMaxBytes * 1024 * 1024
        for (const key of SIZE_ORDER.slice(SIZE_ORDER.indexOf(size))) {
            const url = photo.urls[key]
            if (url === null) {
                continue
            }
            const result = await this.deps.client.download(url, null)
            if (result.byteSize <= maxBytes) {
                return result
            }
            logger.warn(`所选尺寸超过体积上限，降档重试：${photo.id}（${key} / ${String(result.byteSize)} 字节）`)
        }
        return this.downloadWithFallback(photo)
    }

    /**
     * 取照片元数据：内存缓存 → 磁盘列表缓存 → 回源。
     * 关键约束：磁盘里留下的元数据已经过一次校验，能省掉一次详情请求；
     * 读盘失败按未命中处理，绝不因为缓存不可用而阻断插入。
     */
    private async resolvePhoto(photoId: string): Promise<CachedStockPhoto> {
        const cached = this.deps.cache.get(photoId)
        if (cached !== null) {
            return cached
        }
        const stored = findCachedPhoto(await readStockListCache(resolveStorageRoot()), photoId)
        if (stored !== null) {
            this.deps.cache.set(stored)
            return stored
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
        const first = await this.deps.client.download(defaultDownloadUrl(photo), config.stockImageWidth)
        if (first.byteSize <= maxBytes) {
            return first
        }
        logger.warn(`图片超过体积上限，降档重试：${photo.id}（${String(first.byteSize)} 字节）`)
        const fallback = await this.deps.client.download(defaultDownloadUrl(photo), FALLBACK_IMAGE_WIDTH)
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
        const url = toWebviewUri(buildStorageUri(resolveStorageRoot(), relPath.split('/')))
        const editor = target.editor
        // 富文本：插 image 节点，署名已拼进 alt，不需要另插文本片段
        if (editor === undefined) {
            const isInserted = insertIntoRichDocument(target.uri, {
                image: { src: refPath, alt: buildAltText(alt, photographer) },
                text: null,
            })
            if (!isInserted) {
                return { inserted: false, reason: 'no-editor', path: relPath, refPath, source }
            }
            return { inserted: true, path: relPath, refPath, url, source, duplicated: false }
        }
        const snippet = buildSnippet(alt, photographer, refPath)
        const document = editor.document
        const isDuplicated = document.getText().includes(refPath)
        const insertAt = editor.selection.active
        // 引用自成一段：光标夹在行中间时先断开当前行，前后各留一个空行
        const block = buildBlockInsertion(readBlockContext(document, insertAt), snippet)
        const didInsert = await editor.edit((builder) => {
            builder.insert(insertAt, block.text)
        })
        if (!didInsert) {
            return { inserted: false, reason: 'write', path: relPath, refPath, source }
        }
        const range = new vscode.Range(
            insertAt.translate(0, block.start),
            insertAt.translate(0, block.start + snippet.length),
        )
        await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: range })
        return { inserted: true, path: relPath, refPath, url, source, duplicated: isDuplicated }
    }
}
