/**
 * 微博元数据缓存：分组、热搜与表情按「账号指纹 + 版本」落到 {存储根}/weibo.json，跨会话复用。
 * 复用约定：路径走 common/storagePath 的 buildStorageUri，条目校验复用 webTimeline / webHotRank 的归一化函数；
 * 读改写走串行队列，写入先落 .part 再 rename，避免半截 JSON。
 * 关键约束：文件内容按不可信输入逐字段校验，非法条目一律丢弃；只存 Cookie 的不可逆摘要，明文绝不落盘；
 * 版本或账号不符按未命中处理；缓存读写失败不得影响取数回包，也绝不把错误抛给前端。
 */
import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import { buildStorageUri } from '@modules/common/storagePath'
import { isWeiboTimelineId } from '@shared/types/weibo'
import type {
    WeiboEmoticonItem,
    WeiboEmoticonsResult,
    WeiboGroupItem,
    WeiboGroupsResult,
    WeiboHotChannel,
    WeiboHotRankItem,
    WeiboHotRankResult,
    WeiboProfile,
} from '@shared/types/weibo'
import { normalizeHotRankColor } from '../api/hotRank'
import { isRecord, toText } from '../guards'
import { normalizeWeiboImageUrl } from '../timeline/media'

/** 缓存文件名：与 stock 的 unsplash.json 同处存储根，随文档目录一起备份 */
export const WEIBO_CACHE_FILE = 'weibo.json'

/** 缓存文件结构版本：结构变更时递增，旧版本按空缓存处理，下次访问自然重建 */
const CACHE_VERSION = 1

/** 缓存键：四个来源共用一份文件，各自一个顶层字段 */
export type WeiboCacheKey = 'groups' | 'hotRank' | 'emoticons' | 'profile'

/**
 * 各来源的有效期：分组 / 热搜 / 表情不过期——三者都有主动刷新入口（写后失效、刷新按钮、
 * 表情几乎不变），过期回源只会白白增加请求；账号信息没有手动刷新入口，给 7 天，
 * 避免昵称、认证与头像长期停留在旧值。
 */
const CACHE_TTL_MS: Readonly<Record<WeiboCacheKey, number>> = {
    groups: Number.POSITIVE_INFINITY,
    hotRank: Number.POSITIVE_INFINITY,
    emoticons: Number.POSITIVE_INFINITY,
    profile: 7 * 24 * 60 * 60 * 1000,
}

/** 缓存条目：data 为归一化后的回包，fetchedAt 是该结果的取数时刻（ISO） */
export interface WeiboCacheEntry<T> {
    data: T
    fetchedAt: string
}

/** 缓存读写入口：未注入时取数层退化为「每次回源」 */
export interface WeiboCache {
    readGroups(accountKey: string): Promise<WeiboCacheEntry<WeiboGroupsResult> | null>
    readHotRank(accountKey: string): Promise<WeiboCacheEntry<WeiboHotRankResult> | null>
    readEmoticons(accountKey: string): Promise<WeiboCacheEntry<WeiboEmoticonsResult> | null>
    readProfile(accountKey: string): Promise<WeiboCacheEntry<WeiboProfile> | null>
    /** 写入条目：data 已由取数层归一化，这里只负责序列化与原子落盘 */
    write(key: WeiboCacheKey, accountKey: string, data: unknown, fetchedAt: string): Promise<void>
    /** 上次预热时刻：账号不符返回 null，预热据此跳过 */
    readWarmedAt(accountKey: string): Promise<string | null>
    markWarmed(accountKey: string): Promise<void>
    /**
     * 失效分组缓存：关注分组 / 备注写完调用，避免写后读拿到旧快照。
     * 可选方法——未实现时调用方按「无缓存可失效」处理，不影响其它取数。
     */
    invalidateGroups?(accountKey: string): Promise<void>
    /** 整体删除：清除凭证后旧账号数据不应继续留在磁盘上 */
    clear(): Promise<void>
}

/** 落盘条目：data 保持 unknown，读取时按 key 逐字段校验 */
interface RawEntry {
    data: unknown
    fetchedAt: unknown
}

/** 缓存文件：四个来源各自一段，互不覆盖 */
interface WeiboCacheFile {
    version: number
    accountKey: string
    warmedAt: string | null
    groups: RawEntry | null
    hotRank: RawEntry | null
    emoticons: RawEntry | null
    profile: RawEntry | null
}

/** 空缓存：文件缺失、解析失败或版本不符时的统一返回值 */
function emptyFile(): WeiboCacheFile {
    return {
        version: CACHE_VERSION,
        accountKey: '',
        warmedAt: null,
        groups: null,
        hotRank: null,
        emoticons: null,
        profile: null,
    }
}

/**
 * 账号指纹：Cookie 的不可逆摘要前 16 位。
 * 关键约束：存储根通常在用户资料目录内，可能被同步或提交，Cookie 明文绝不能写进去。
 */
export function toAccountKey(cookie: string): string {
    return createHash('sha256').update(cookie, 'utf8').digest('hex').slice(0, 16)
}

/** 取正整数：0 与非法值都返回 0，由调用方判空 */
function toPositiveInt(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** 可选文本：空串归一为 null，契约里「无此标记」只用一个值表达 */
function toOptionalText(value: unknown): string | null {
    const text = toText(value).trim()
    return text.length > 0 ? text : null
}

/** 时间戳还原：不可解析一律 null，宁可当作过期也不展示僵尸数据 */
function readTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        return null
    }
    return value
}

/** 条目是否仍在有效期内：TTL 为无穷时恒真 */
function isFresh(key: WeiboCacheKey, fetchedAt: string): boolean {
    const ttl = CACHE_TTL_MS[key]
    return !Number.isFinite(ttl) || Date.now() - Date.parse(fetchedAt) < ttl
}

/** 单条分组还原：gid 必须是数字串、标题非空，其余字段缺失按空值处理 */
function parseGroupItem(value: unknown): WeiboGroupItem | null {
    if (!isRecord(value)) {
        return null
    }
    const gid = toText(value.gid)
    const title = toText(value.title).trim()
    if (!isWeiboTimelineId(gid) || title.length === 0) {
        return null
    }
    const uid = toText(value.uid)
    return { gid, title, uid: isWeiboTimelineId(uid) ? uid : '', isCustom: value.isCustom === true }
}

/** 分组分区还原：不是数组即结构异常；空数组合法但整体由 parseGroupsResult 判空 */
function parseGroupList(value: unknown): WeiboGroupItem[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const items: WeiboGroupItem[] = []
    for (const entry of value) {
        const item = parseGroupItem(entry)
        if (item !== null) {
            items.push(item)
        }
    }
    return items
}

/** 热门频道还原：gid 与标题必须非空，containerid 缺失时按 gid 兜底（推荐频道就是同值） */
function parseHotChannelList(value: unknown): WeiboHotChannel[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const channels: WeiboHotChannel[] = []
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue
        }
        const gid = toText(entry.gid).trim()
        const title = toText(entry.title).trim()
        if (gid.length === 0 || title.length === 0) {
            continue
        }
        const containerId = toText(entry.containerId).trim()
        channels.push({ gid, title, containerId: containerId.length > 0 ? containerId : gid })
    }
    return channels
}

/** 分组结果还原：两组都为空视为无效缓存——上游异常时的空结果不该被固化 */
function parseGroupsResult(value: unknown): WeiboGroupsResult | null {
    if (!isRecord(value)) {
        return null
    }
    const defaultGroups = parseGroupList(value.defaultGroups)
    const myGroups = parseGroupList(value.myGroups)
    const hotChannels = parseHotChannelList(value.hotChannels)
    if (defaultGroups === null || myGroups === null || defaultGroups.length + myGroups.length === 0) {
        return null
    }
    // 旧版缓存没有热门频道字段：按无效处理，强制回源一次，避免热门菜单长期为空
    if (hotChannels === null) {
        return null
    }
    const listId = toText(value.timelineListId)
    const uid = toText(value.uid)
    return {
        defaultGroups,
        myGroups,
        hotChannels,
        timelineListId: isWeiboTimelineId(listId) ? listId : null,
        uid: isWeiboTimelineId(uid) ? uid : null,
    }
}

/** 单条榜单还原：名次必须为正、标题非空，图地址与徽标色都过白名单并重新归一化 */
function parseHotRankItem(value: unknown): WeiboHotRankItem | null {
    if (!isRecord(value)) {
        return null
    }
    const rank = toPositiveInt(value.rank)
    const title = toText(value.title).trim()
    if (rank === 0 || title.length === 0) {
        return null
    }
    return {
        rank,
        title,
        description: toOptionalText(value.description),
        iconUrl: typeof value.iconUrl === 'string' ? normalizeWeiboImageUrl(value.iconUrl) : null,
        iconDesc: toOptionalText(value.iconDesc),
        iconDescColor: normalizeHotRankColor(value.iconDescColor),
    }
}

/** 热搜结果还原：空榜视为无效缓存，避免侧栏长期展示空榜 */
function parseHotRankResult(value: unknown): WeiboHotRankResult | null {
    if (!isRecord(value) || !Array.isArray(value.items)) {
        return null
    }
    const items: WeiboHotRankItem[] = []
    for (const entry of value.items) {
        const item = parseHotRankItem(entry)
        if (item !== null) {
            items.push(item)
        }
    }
    if (items.length === 0) {
        return null
    }
    const fetchedAt = readTimestamp(value.fetchedAt)
    return fetchedAt === null ? null : { items, fetchedAt }
}

/** 单条表情还原：phrase 与图床直链缺一不可，分类按原值保留 */
function parseEmoticon(value: unknown): WeiboEmoticonItem | null {
    if (!isRecord(value)) {
        return null
    }
    const phrase = toText(value.phrase)
    const url = typeof value.url === 'string' ? normalizeWeiboImageUrl(value.url) : null
    if (phrase.length === 0 || url === null) {
        return null
    }
    return { phrase, url, category: toText(value.category) }
}

/** 表情结果还原：空表视为无效缓存，避免表情面板永久空白 */
function parseEmoticonsResult(value: unknown): WeiboEmoticonsResult | null {
    if (!isRecord(value) || !Array.isArray(value.emoticons)) {
        return null
    }
    const emoticons: WeiboEmoticonItem[] = []
    for (const entry of value.emoticons) {
        const item = parseEmoticon(entry)
        if (item !== null) {
            emoticons.push(item)
        }
    }
    if (emoticons.length === 0) {
        return null
    }
    const fetchedAt = readTimestamp(value.fetchedAt)
    return fetchedAt === null ? null : { emoticons, fetchedAt }
}

/** 账号信息还原：id 与昵称缺一不可，头像地址重新过图床白名单 */
function parseProfileResult(value: unknown): WeiboProfile | null {
    if (!isRecord(value)) {
        return null
    }
    const id = toText(value.id)
    const name = toText(value.name).trim()
    if (!isWeiboTimelineId(id) || name.length === 0) {
        return null
    }
    return {
        id,
        name,
        avatarUrl: typeof value.avatarUrl === 'string' ? (normalizeWeiboImageUrl(value.avatarUrl) ?? '') : '',
        isVerified: value.isVerified === true,
        description: toText(value.description),
        followersCount: toPositiveInt(value.followersCount),
        friendsCount: toPositiveInt(value.friendsCount),
        statusesCount: toPositiveInt(value.statusesCount),
    }
}

/** 文件整体还原：版本不符或结构异常一律按空缓存处理，让下一次访问自愈 */
function parseCacheFile(raw: unknown): WeiboCacheFile {
    if (!isRecord(raw) || raw.version !== CACHE_VERSION) {
        return emptyFile()
    }
    const readEntry = (value: unknown): RawEntry | null =>
        isRecord(value) ? { data: value.data, fetchedAt: value.fetchedAt } : null
    return {
        version: CACHE_VERSION,
        accountKey: toText(raw.accountKey),
        warmedAt: readTimestamp(raw.warmedAt),
        groups: readEntry(raw.groups),
        hotRank: readEntry(raw.hotRank),
        emoticons: readEntry(raw.emoticons),
        profile: readEntry(raw.profile),
    }
}

/** 缓存文件 Uri：{存储根}/weibo.json */
function resolveCacheUri(root: vscode.Uri): vscode.Uri {
    return buildStorageUri(root, [WEIBO_CACHE_FILE])
}

/** 读取缓存文件：缺失、不可读或内容不合法都返回空缓存，读取路径永不抛错 */
async function readCacheFile(root: vscode.Uri): Promise<WeiboCacheFile> {
    try {
        const bytes = await vscode.workspace.fs.readFile(resolveCacheUri(root))
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
        return parseCacheFile(parsed)
    } catch {
        return emptyFile()
    }
}

/** 落盘：先写 .part 再 rename，避免写到一半被中断留下半个 JSON */
async function writeCacheFile(root: vscode.Uri, file: WeiboCacheFile): Promise<void> {
    const tempUri = buildStorageUri(root, [`${WEIBO_CACHE_FILE}.part`])
    await vscode.workspace.fs.createDirectory(root)
    await vscode.workspace.fs.writeFile(tempUri, new TextEncoder().encode(JSON.stringify(file)))
    await vscode.workspace.fs.rename(tempUri, resolveCacheUri(root), { overwrite: true })
}

/** 串行队列：同一进程内的读改写依次执行，三个来源并发回源时不会互相覆盖 */
let writeQueue: Promise<void> = Promise.resolve()

/** 替换指定键的条目：用显式分支而非计算属性，避免把联合类型放宽成索引签名 */
function withEntry(file: WeiboCacheFile, key: WeiboCacheKey, entry: RawEntry): WeiboCacheFile {
    switch (key) {
        case 'groups':
            return { ...file, groups: entry }
        case 'hotRank':
            return { ...file, hotRank: entry }
        case 'emoticons':
            return { ...file, emoticons: entry }
        case 'profile':
            return { ...file, profile: entry }
        default:
            return file
    }
}

/**
 * 读改写：账号不符时整份重建，避免旧账号的数据被新条目「续命」。
 * 关键约束：必须排队——三个来源可能同时回源完成，各自持有一份旧快照会丢掉对方的写入。
 */
async function updateFile(
    root: vscode.Uri,
    accountKey: string,
    mutate: (file: WeiboCacheFile) => WeiboCacheFile,
): Promise<void> {
    const task = writeQueue.then(async (): Promise<void> => {
        const current = await readCacheFile(root)
        const base = current.accountKey === accountKey ? current : { ...emptyFile(), accountKey }
        await writeCacheFile(root, mutate(base))
    })
    // 队列自身吞掉异常：单次写入失败只影响这一次缓存，后续写入不受牵连
    writeQueue = task.catch(() => undefined)
    return task
}

/** 按账号读一条缓存：账号为空或与文件不符即未命中 */
async function readEntry<T>(
    root: vscode.Uri,
    accountKey: string,
    pick: (file: WeiboCacheFile) => WeiboCacheEntry<T> | null,
): Promise<WeiboCacheEntry<T> | null> {
    if (accountKey.length === 0) {
        return null
    }
    const file = await readCacheFile(root)
    if (file.accountKey !== accountKey) {
        return null
    }
    return pick(file)
}

/** 单个条目的通用校验：时间不可解析或已过期即未命中 */
function parseEntry<T>(
    raw: RawEntry | null,
    key: WeiboCacheKey,
    parse: (data: unknown) => T | null,
): WeiboCacheEntry<T> | null {
    if (raw === null) {
        return null
    }
    const fetchedAt = readTimestamp(raw.fetchedAt)
    if (fetchedAt === null || !isFresh(key, fetchedAt)) {
        return null
    }
    const data = parse(raw.data)
    return data === null ? null : { data, fetchedAt }
}

/** 创建缓存读写器：root 通常取 resolveStorageRoot()，配置变更后重开面板即生效 */
export function createWeiboCache(root: vscode.Uri, now: () => Date = (): Date => new Date()): WeiboCache {
    return {
        readGroups: async (accountKey: string): Promise<WeiboCacheEntry<WeiboGroupsResult> | null> =>
            readEntry(root, accountKey, (file) => parseEntry(file.groups, 'groups', parseGroupsResult)),
        readHotRank: async (accountKey: string): Promise<WeiboCacheEntry<WeiboHotRankResult> | null> =>
            readEntry(root, accountKey, (file) => parseEntry(file.hotRank, 'hotRank', parseHotRankResult)),
        readEmoticons: async (accountKey: string): Promise<WeiboCacheEntry<WeiboEmoticonsResult> | null> =>
            readEntry(root, accountKey, (file) => parseEntry(file.emoticons, 'emoticons', parseEmoticonsResult)),
        readProfile: async (accountKey: string): Promise<WeiboCacheEntry<WeiboProfile> | null> =>
            readEntry(root, accountKey, (file) => parseEntry(file.profile, 'profile', parseProfileResult)),
        write: async (key: WeiboCacheKey, accountKey: string, data: unknown, fetchedAt: string): Promise<void> => {
            await updateFile(root, accountKey, (file) => withEntry(file, key, { data, fetchedAt }))
        },
        readWarmedAt: async (accountKey: string): Promise<string | null> => {
            if (accountKey.length === 0) {
                return null
            }
            const file = await readCacheFile(root)
            return file.accountKey === accountKey ? file.warmedAt : null
        },
        markWarmed: async (accountKey: string): Promise<void> => {
            await updateFile(root, accountKey, (file) => ({ ...file, warmedAt: now().toISOString() }))
        },
        invalidateGroups: async (accountKey: string): Promise<void> => {
            await updateFile(root, accountKey, (file) => ({ ...file, groups: null }))
        },
        clear: async (): Promise<void> => {
            const task = writeQueue.then(async (): Promise<void> => {
                try {
                    await vscode.workspace.fs.delete(resolveCacheUri(root), { useTrash: false })
                } catch {
                    // 文件本就不存在：清除语义已经达成
                }
            })
            writeQueue = task.catch(() => undefined)
            await task
        },
    }
}
