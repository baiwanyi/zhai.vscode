/**
 * 在线图库列表缓存：浏览流与各话题流按「页」把照片元数据落到 {存储根}/unsplash.json，跨会话复用并按 8 小时过期。
 * 复用约定：路径拼接走 common/storagePath 的 buildStorageUri，条目结构沿用 ./cache 的 CachedStockPhoto，
 * 有效期、页数与条目上限统一由 ./constants 给出，服务层只经由本模块读写文件。
 * 关键约束：只缓存实际加载过的页——首页进来只抓第 1 页，滚动续载时才抓下一页，两处口径完全一致；
 * 文件内容按不可信输入处理（id、尺寸与下载地址逐项校验，只放行 https 的 Unsplash 主机），非法条目丢弃；
 * 写入先落 .part 再 rename，且所有读改写排队执行，避免两个页面先后落盘互相覆盖。
 */
import * as vscode from 'vscode'
import { buildStorageUri } from '@modules/common/storagePath'
import { isStockOrderBy, isStockOrientation, isStockPhotoId, isStockTopicId } from '@shared/types/stock'
import type { StockOrderBy, StockOrientation } from '@shared/types/stock'
import { STOCK_LIST_CACHE_FILE, STOCK_LIST_MAX_ENTRIES, STOCK_LIST_MAX_PAGES, STOCK_LIST_TTL_MS } from './constants'
import type { CachedStockPhoto, StockPhotoUrls } from './cache'

/** 缓存文件结构版本：结构变更时递增，旧版本文件按空缓存处理，下次访问自然重建 */
const CACHE_VERSION = 2
/** 图片 CDN 主机：缓存里的下载地址只允许指向这里 */
const IMAGE_HOST = 'images.unsplash.com'
/** 接口主机：下载计数端点只允许指向这里 */
const API_HOST = 'api.unsplash.com'
/** 署名页主机：摄影者主页只允许 unsplash.com 及其子域 */
const SITE_HOST = 'unsplash.com'

/** 列表标识的组成要素：话题优先，推荐流再按方向与排序区分 */
export interface StockListKeyInput {
    topic: string | null
    orientation: StockOrientation | null
    orderBy: StockOrderBy | null
}

/** 一页缓存：抓取时刻与分页信息随照片一起存，读取时按页判定有效期 */
export interface StockCachedPage {
    page: number
    photos: CachedStockPhoto[]
    /** 该页抓取时刻（ISO）：有效期按页计，首页与后续页同一口径 */
    syncedAt: string
    /** 抓取时的每页条数：与当前配置不一致时该页作废，否则前后页会重叠 */
    perPage: number
    hasMore: boolean
    totalPages: number
    total: number
}

/** 一个列表的缓存：页按页码升序，最多 STOCK_LIST_MAX_PAGES 页 */
export interface StockCachedList {
    key: string
    topic: string | null
    orientation: StockOrientation | null
    orderBy: StockOrderBy | null
    pages: StockCachedPage[]
}

/** 缓存文件：lists 以列表标识为键，页在列表内按页码排列 */
export interface StockListCacheFile {
    version: number
    lists: Record<string, StockCachedList>
}

/** 空缓存：文件缺失、解析失败或版本不符时的统一返回值 */
function emptyCache(): StockListCacheFile {
    return { version: CACHE_VERSION, lists: {} }
}

/** 缓存文件 Uri：{存储根}/unsplash.json */
function resolveCacheUri(root: vscode.Uri): vscode.Uri {
    return buildStorageUri(root, [STOCK_LIST_CACHE_FILE])
}

/** 列表标识：话题直接用自己的 slug；推荐流把方向与排序并进键，避免三组筛选互相覆盖 */
export function toStockListKey(input: StockListKeyInput): string {
    if (input.topic !== null) {
        return input.topic
    }
    return `feed|${input.orientation ?? 'any'}|${input.orderBy ?? 'default'}`
}

/** 页是否仍在有效期内：抓取时刻解析失败按过期处理，宁可多取一次也不展示僵尸数据 */
export function isStockPageFresh(page: StockCachedPage): boolean {
    const syncedAt = Date.parse(page.syncedAt)
    return Number.isFinite(syncedAt) && Date.now() - syncedAt < STOCK_LIST_TTL_MS
}

/**
 * 页是否可直接复用：既要在有效期内，也要与当前每页条数一致。
 * 关键约束：per_page 变了分页边界就变，沿用旧页会让相邻两页出现重复条目。
 */
export function isStockPageUsable(page: StockCachedPage, perPage: number): boolean {
    return page.perPage === perPage && isStockPageFresh(page)
}

/** 取指定页：不存在返回 null，由调用方决定回源 */
export function findCachedPage(list: StockCachedList | undefined, page: number): StockCachedPage | null {
    if (list === undefined) {
        return null
    }
    return list.pages.find((item) => item.page === page) ?? null
}

/** 列表最近一次同步时刻：淘汰旧列表时按它排序 */
function readListSyncedAt(list: StockCachedList): string {
    return list.pages[list.pages.length - 1]?.syncedAt ?? ''
}

/** 取字符串字段：类型不符返回空串 */
function readString(source: Record<string, unknown>, key: string): string {
    const value = source[key]
    return typeof value === 'string' ? value : ''
}

/** 取正整数：非法值按 0 处理，页码与条数都只接受正数 */
function readPositiveInt(source: Record<string, unknown>, key: string): number {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 取边长：非正或非有限数按 0 处理，缺边长只影响档位换算，不影响列表可用性 */
function readDimension(source: Record<string, unknown>, key: string): number {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * 校验缓存中的外链：只放行 https、默认端口且主机精确匹配的地址。
 * 安全约束：这些地址会被宿主直接 fetch（含下载与计数），手改文件后不得把请求引向内网或 file 协议。
 */
function readSafeUrl(value: unknown, host: string): string | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null
    }
    try {
        const url = new URL(value)
        const isHostAllowed =
            host === SITE_HOST
                ? url.hostname === SITE_HOST || url.hostname.endsWith(`.${SITE_HOST}`)
                : url.hostname === host
        return url.protocol === 'https:' && url.port === '' && isHostAllowed ? value : null
    } catch {
        return null
    }
}

/** 照片元数据还原：四档地址全缺即认为该条不可用，与上游收窄口径保持一致 */
function parsePhoto(raw: unknown): CachedStockPhoto | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }
    const source = raw as Record<string, unknown>
    const id = source.id
    if (!isStockPhotoId(id)) {
        return null
    }
    const urls = typeof source.urls === 'object' && source.urls !== null ? (source.urls as Record<string, unknown>) : {}
    const photoUrls: StockPhotoUrls = {
        raw: readSafeUrl(urls.raw, IMAGE_HOST),
        full: readSafeUrl(urls.full, IMAGE_HOST),
        regular: readSafeUrl(urls.regular, IMAGE_HOST),
        small: readSafeUrl(urls.small, IMAGE_HOST),
    }
    if (photoUrls.raw === null && photoUrls.full === null && photoUrls.regular === null) {
        return null
    }
    return {
        id,
        width: readDimension(source, 'width'),
        height: readDimension(source, 'height'),
        alt: readString(source, 'alt'),
        photographer: readString(source, 'photographer'),
        photographerUrl: readSafeUrl(source.photographerUrl, SITE_HOST) ?? '',
        urls: photoUrls,
        downloadLocation: readSafeUrl(source.downloadLocation, API_HOST),
    }
}

/** 单页还原：抓取时刻必须可解析，照片逐条校验，空页视为无效 */
function parsePage(raw: unknown): StockCachedPage | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }
    const source = raw as Record<string, unknown>
    const page = readPositiveInt(source, 'page')
    const syncedAt = readString(source, 'syncedAt')
    if (page === 0 || page > STOCK_LIST_MAX_PAGES || !Number.isFinite(Date.parse(syncedAt))) {
        return null
    }
    const photos: CachedStockPhoto[] = []
    if (Array.isArray(source.photos)) {
        for (const item of source.photos) {
            const photo = parsePhoto(item)
            if (photo !== null) {
                photos.push(photo)
            }
        }
    }
    if (photos.length === 0) {
        return null
    }
    return {
        page,
        photos,
        syncedAt,
        perPage: readPositiveInt(source, 'perPage'),
        hasMore: source.hasMore === true,
        totalPages: readPositiveInt(source, 'totalPages'),
        total: readPositiveInt(source, 'total'),
    }
}

/** 单列表还原：页按页码升序去重，超过上限的尾部页丢弃 */
function parseList(raw: unknown, key: string): StockCachedList | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }
    const source = raw as Record<string, unknown>
    const pages: StockCachedPage[] = []
    if (Array.isArray(source.pages)) {
        for (const item of source.pages) {
            const page = parsePage(item)
            if (page !== null && !pages.some((known) => known.page === page.page)) {
                pages.push(page)
            }
        }
    }
    if (pages.length === 0) {
        return null
    }
    pages.sort((left, right) => left.page - right.page)
    return {
        key,
        topic: isStockTopicId(source.topic) ? source.topic : null,
        orientation: isStockOrientation(source.orientation) ? source.orientation : null,
        orderBy: isStockOrderBy(source.orderBy) ? source.orderBy : null,
        pages: pages.filter((page) => page.page <= STOCK_LIST_MAX_PAGES),
    }
}

/** 文件整体还原：版本不符或结构异常一律按空缓存处理，让下一次访问自愈 */
function parseCacheFile(raw: unknown): StockListCacheFile {
    if (typeof raw !== 'object' || raw === null) {
        return emptyCache()
    }
    const source = raw as Record<string, unknown>
    if (source.version !== CACHE_VERSION) {
        return emptyCache()
    }
    const rawLists =
        typeof source.lists === 'object' && source.lists !== null ? (source.lists as Record<string, unknown>) : {}
    const lists: Record<string, StockCachedList> = {}
    for (const [key, value] of Object.entries(rawLists)) {
        const list = parseList(value, key)
        if (list !== null) {
            lists[key] = list
        }
    }
    return { version: CACHE_VERSION, lists }
}

/** 条目淘汰：超出上限时保留最近同步的那几条，话题与排序的排列组合不会把文件越撑越大 */
function pruneLists(lists: Record<string, StockCachedList>): Record<string, StockCachedList> {
    const entries = Object.entries(lists)
    if (entries.length <= STOCK_LIST_MAX_ENTRIES) {
        return lists
    }
    return Object.fromEntries(
        entries
            .sort((left, right) => readListSyncedAt(right[1]).localeCompare(readListSyncedAt(left[1])))
            .slice(0, STOCK_LIST_MAX_ENTRIES),
    )
}

/**
 * 把一页并入列表：该页之前且每页条数一致的页保留，其余（含该页本身与之后）一律丢弃。
 * 关键约束：分页顺序可能随上游刷新而变化，旧的第 N+1 页接不上新的第 N 页；
 * 每页条数改动也会让前后页错位，两种情况都必须一起作废。
 */
export function mergeCachedPage(
    list: StockCachedList | undefined,
    base: StockListKeyInput,
    page: StockCachedPage,
): StockCachedList {
    const kept =
        list === undefined ? [] : list.pages.filter((item) => item.page < page.page && item.perPage === page.perPage)
    return {
        key: list?.key ?? toStockListKey(base),
        topic: base.topic,
        orientation: base.orientation,
        orderBy: base.orderBy,
        pages: [...kept, page].slice(0, STOCK_LIST_MAX_PAGES),
    }
}

/** 读取缓存：文件缺失、不可读或内容不合法都返回空缓存，读取路径永不抛错 */
export async function readStockListCache(root: vscode.Uri): Promise<StockListCacheFile> {
    try {
        const bytes = await vscode.workspace.fs.readFile(resolveCacheUri(root))
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
        return parseCacheFile(parsed)
    } catch {
        return emptyCache()
    }
}

/** 落盘：先写 .part 再 rename，避免写到一半被中断留下半个 JSON */
async function writeCacheFile(root: vscode.Uri, file: StockListCacheFile): Promise<void> {
    const tempUri = buildStorageUri(root, [`${STOCK_LIST_CACHE_FILE}.part`])
    await vscode.workspace.fs.createDirectory(root)
    await vscode.workspace.fs.writeFile(tempUri, new TextEncoder().encode(JSON.stringify(file)))
    await vscode.workspace.fs.rename(tempUri, resolveCacheUri(root), { overwrite: true })
}

/** 串行队列：同一进程内的读改写依次执行，后完成的页不会覆盖先完成的另一个列表 */
let writeQueue: Promise<void> = Promise.resolve()

/**
 * 保存一个列表：整体覆盖同标识的旧条目。
 * 关键约束：读改写必须排队——两页可能同时回源完成，各自持有一份旧快照会丢掉对方的写入。
 */
export async function saveStockList(root: vscode.Uri, list: StockCachedList): Promise<void> {
    const task = writeQueue.then(async (): Promise<void> => {
        const current = await readStockListCache(root)
        const lists = pruneLists({ ...current.lists, [list.key]: list })
        await writeCacheFile(root, { version: CACHE_VERSION, lists })
    })
    // 队列自身吞掉异常：单次写入失败只影响这一次缓存，后续写入不受牵连
    writeQueue = task.catch(() => undefined)
    return task
}

/** 按标识在缓存中找一张照片：插入旧图时优先复用，避免为取元数据再消耗一次配额 */
export function findCachedPhoto(file: StockListCacheFile, photoId: string): CachedStockPhoto | null {
    for (const list of Object.values(file.lists)) {
        for (const page of list.pages) {
            const photo = page.photos.find((item) => item.id === photoId)
            if (photo !== undefined) {
                return photo
            }
        }
    }
    return null
}
