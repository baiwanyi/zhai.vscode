/**
 * 数据统计服务：官方文档四类统计接口的统一入口。
 * 复用约定：Token 走 accountToken，报文收窄走 openapi 的 fetchDatacube；视图元数据与请求契约共用 shared/types/wechat；
 * 所有视图统一返回「指标 + 数据点 + 分类分布 + 逐篇明细」，由界面用同一套组件渲染。
 * 关键约束：按 WECHAT_STATS_VIEW_META 的单次跨度分段取数（用户 7 天、消息日概况 6 天、分布 15 天、
 * 分时与发表内容明细 1 天），结束日期不得晚于昨天；平台字段逐项收窄为数字，异常报文不当成有效数据统计。
 */
import type {
    WechatStatsBreakdown,
    WechatStatsDataPoint,
    WechatStatsItem,
    WechatStatsMetric,
    WechatStatsPoint,
    WechatStatsQueryRequest,
    WechatStatsQueryResult,
    WechatStatsRange,
    WechatStatsRequest,
    WechatStatsResult,
    WechatStatsView,
} from '@shared/types/wechat'
import { WECHAT_STATS_VIEW_META } from '@shared/types/wechat'
import { formatDateKey, readYesterdayKey } from '@shared/utils/date'
import { requireWechatToken } from './accountToken'
import {
    ARTICLE_READ_ENDPOINT,
    ARTICLE_SHARE_ENDPOINT,
    ARTICLE_SUMMARY_ENDPOINT,
    ARTICLE_TOTAL_DETAIL_ENDPOINT,
    ARTICLE_TOTAL_ENDPOINT,
    BIZ_SUMMARY_ENDPOINT,
    INTERFACE_SUMMARY_ENDPOINT,
    INTERFACE_SUMMARY_HOUR_ENDPOINT,
    UPSTREAM_MSG_DIST_ENDPOINT,
    UPSTREAM_MSG_DIST_MONTH_ENDPOINT,
    UPSTREAM_MSG_DIST_WEEK_ENDPOINT,
    UPSTREAM_MSG_ENDPOINT,
    UPSTREAM_MSG_HOUR_ENDPOINT,
    UPSTREAM_MSG_MONTH_ENDPOINT,
    UPSTREAM_MSG_WEEK_ENDPOINT,
    USER_READ_ENDPOINT,
    USER_READ_HOUR_ENDPOINT,
    USER_SHARE_ENDPOINT,
    USER_SHARE_HOUR_ENDPOINT,
    USERS_CUMULATE_ENDPOINT,
    USERS_SUMMARY_ENDPOINT,
} from './endpoints'
import { fetchDatacube } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'
import type { WechatDatacubeRow } from './openapi'

/** 一天的毫秒数 */
const DAY_MS = 86_400_000

/** 视图到平台端点的映射：集中一处，便于核对官方文档路径 */
const VIEW_ENDPOINTS: Readonly<Record<WechatStatsView, string>> = {
    userDaily: USERS_SUMMARY_ENDPOINT,
    userCumulate: USERS_CUMULATE_ENDPOINT,
    newsSummary: ARTICLE_SUMMARY_ENDPOINT,
    newsReadHour: USER_READ_HOUR_ENDPOINT,
    newsShareHour: USER_SHARE_HOUR_ENDPOINT,
    newsRead: USER_READ_ENDPOINT,
    newsShare: USER_SHARE_ENDPOINT,
    newsTotal: ARTICLE_TOTAL_ENDPOINT,
    newsBiz: BIZ_SUMMARY_ENDPOINT,
    newsArticleRead: ARTICLE_READ_ENDPOINT,
    newsArticleShare: ARTICLE_SHARE_ENDPOINT,
    newsArticleDetail: ARTICLE_TOTAL_DETAIL_ENDPOINT,
    msgDaily: UPSTREAM_MSG_ENDPOINT,
    msgHour: UPSTREAM_MSG_HOUR_ENDPOINT,
    msgWeek: UPSTREAM_MSG_WEEK_ENDPOINT,
    msgMonth: UPSTREAM_MSG_MONTH_ENDPOINT,
    msgDist: UPSTREAM_MSG_DIST_ENDPOINT,
    msgDistWeek: UPSTREAM_MSG_DIST_WEEK_ENDPOINT,
    msgDistMonth: UPSTREAM_MSG_DIST_MONTH_ENDPOINT,
    apiDaily: INTERFACE_SUMMARY_ENDPOINT,
    apiHour: INTERFACE_SUMMARY_HOUR_ENDPOINT,
}

/** 用户来源代码 → 展示名：官方文档 getusersummary.user_source */
const USER_SOURCE_LABELS: Readonly<Record<number, string>> = {
    0: '其他合计',
    1: '公众号搜索',
    17: '名片分享',
    30: '扫描二维码',
    57: '文章内账号名称',
    100: '微信广告',
    161: '他人转载',
    149: '小程序关注',
    200: '视频号',
    201: '直播',
}

/** 阅读来源代码 → 展示名：官方文档 user_source */
const READ_SOURCE_LABELS: Readonly<Record<number, string>> = {
    99999999: '全部',
    0: '会话',
    1: '好友',
    2: '朋友圈',
    4: '历史消息页',
    5: '其他',
    6: '看一看',
    7: '搜一搜',
}

/** 分享场景代码 → 展示名 */
const SHARE_SCENE_LABELS: Readonly<Record<number, string>> = { 1: '好友转发', 2: '朋友圈', 255: '其他' }

/** 消息类型代码 → 展示名 */
const MSG_TYPE_LABELS: Readonly<Record<number, string>> = {
    1: '文字',
    2: '图片',
    3: '语音',
    4: '视频',
    6: '链接',
}

/** 发送量区间代码 → 展示名 */
const COUNT_INTERVAL_LABELS: Readonly<Record<number, string>> = {
    0: '0 条',
    1: '1-5 条',
    2: '6-10 条',
    3: '10 条以上',
}

/** 按代码表取展示名，未知代码回落为「其他(code)」，不静默丢弃 */
function labelOf(labels: Readonly<Record<number, string>>, code: number): string {
    return labels[code] ?? `其他(${String(code)})`
}

/** 安全读取平台数字字段：非数字一律视为 0，避免脏报文污染统计 */
function readNumber(row: WechatDatacubeRow, key: string): number {
    const value = row[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 安全读取平台字符串字段 */
function readString(row: WechatDatacubeRow, key: string): string {
    const value = row[key]
    return typeof value === 'string' ? value : ''
}

/** 安全读取嵌套对象字段 */
function readNested(row: WechatDatacubeRow, key: string): WechatDatacubeRow {
    const value = row[key]
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as WechatDatacubeRow) : {}
}

/** 安全读取嵌套数组字段 */
function readNestedList(row: WechatDatacubeRow, key: string): WechatDatacubeRow[] {
    const value = row[key]
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .filter((item): item is object => typeof item === 'object' && item !== null)
        .map((item) => item as WechatDatacubeRow)
}

/** 日期键转时间戳：按 UTC 解析，避免本地时区漂移 */
function fromDateKey(date: string): number {
    return Date.parse(`${date}T00:00:00Z`)
}

/** 生成区间内全部日期键，缺失日期也要保留，横轴才不会断档 */
function dateKeys(beginDate: string, endDate: string): string[] {
    const dates: string[] = []
    for (let time = fromDateKey(beginDate); time <= fromDateKey(endDate); time += DAY_MS) {
        dates.push(new Date(time).toISOString().slice(0, 10))
    }
    return dates
}

/** 按平台单次上限切分连续区间 */
function splitRange(beginDate: string, endDate: string, maxDays: number): { beginDate: string; endDate: string }[] {
    const chunks: { beginDate: string; endDate: string }[] = []
    let cursor = fromDateKey(beginDate)
    const end = fromDateKey(endDate)
    while (cursor <= end) {
        const chunkEnd = Math.min(cursor + (maxDays - 1) * DAY_MS, end)
        chunks.push({
            beginDate: new Date(cursor).toISOString().slice(0, 10),
            endDate: new Date(chunkEnd).toISOString().slice(0, 10),
        })
        cursor = chunkEnd + DAY_MS
    }
    return chunks
}

/**
 * 解析统计区间：预设档位以昨天为终点；自定义区间拒绝未来日期、超 30 天与早于数据起始日。
 * 关键约束：当天未结算，结束日期放到今天会得到空行；新接口数据从 2025-11-01 起，更早区间会得到空结果。
 */
export function readStatsRange(
    range: WechatStatsRange,
    view: WechatStatsView,
    now: Date,
): { beginDate: string; endDate: string } {
    const yesterday = readYesterdayKey(now)
    let beginDate: string
    let endDate: string
    if (range.kind === 'days') {
        endDate = yesterday
        beginDate = formatDateKey(new Date(fromDateKey(yesterday) - (range.days - 1) * DAY_MS))
    } else {
        if (range.beginDate > range.endDate) {
            throw new Error('开始日期不能晚于结束日期。')
        }
        if (range.endDate > yesterday) {
            throw new Error(`结束日期不能晚于 ${yesterday}：当天数据尚未结算，请在次日 8 点后查询。`)
        }
        beginDate = range.beginDate
        endDate = range.endDate
        const spanDays = (fromDateKey(endDate) - fromDateKey(beginDate)) / DAY_MS + 1
        if (spanDays > 30) {
            throw new Error('单次最多查询 30 天，请缩小时间范围。')
        }
    }
    const meta = WECHAT_STATS_VIEW_META[view]
    if (endDate < meta.since) {
        throw new Error(`${meta.label}的数据从 ${meta.since} 开始记录，请选择更晚的日期。`)
    }
    return { beginDate: beginDate < meta.since ? meta.since : beginDate, endDate }
}

/** 指标定义：key 同时作为数据点 values 的键 */
type MetricDef = Omit<WechatStatsMetric, 'total'>

/** 生成指标汇总 */
function makeMetrics(defs: readonly MetricDef[], totals: Record<string, number>): WechatStatsMetric[] {
    return defs.map((def) => ({ ...def, total: totals[def.key] ?? 0 }))
}

/** 按日期聚合数值：同一天多行累加 */
type RowsByDate = Map<string, Record<string, number>>

/** 累加一行到按日期聚合表 */
function addRow(target: RowsByDate, date: string, values: Record<string, number>): void {
    const current = target.get(date) ?? {}
    for (const [key, value] of Object.entries(values)) {
        current[key] = (current[key] ?? 0) + value
    }
    target.set(date, current)
}

/** 按日期生成有序数据点，缺失日期补 0 */
function makePoints(
    beginDate: string,
    endDate: string,
    rows: RowsByDate,
    keys: readonly string[],
): WechatStatsDataPoint[] {
    return dateKeys(beginDate, endDate).map((date) => {
        const row = rows.get(date)
        const values: Record<string, number> = {}
        for (const key of keys) {
            values[key] = row?.[key] ?? 0
        }
        return { date, values }
    })
}

/** 对按日期聚合表求和 */
function sumKey(rows: RowsByDate, key: string): number {
    let total = 0
    for (const row of rows.values()) {
        total += row[key] ?? 0
    }
    return total
}

/** 对按日期聚合表取最大值 */
function maxKey(rows: RowsByDate, key: string): number {
    let peak = 0
    for (const row of rows.values()) {
        peak = Math.max(peak, row[key] ?? 0)
    }
    return peak
}

/** 按指标定义汇总 */
function totalsFrom(rows: RowsByDate, defs: readonly MetricDef[]): Record<string, number> {
    return Object.fromEntries(defs.map((def) => [def.key, sumKey(rows, def.key)]))
}

/** 分类分布累加：按标签聚合数值 */
function makeBreakdowns(
    rows: WechatDatacubeRow[],
    codeKey: string,
    valueKey: string,
    labels: Readonly<Record<number, string>>,
): WechatStatsBreakdown[] {
    const totals = new Map<string, number>()
    for (const row of rows) {
        const label = labelOf(labels, readNumber(row, codeKey))
        totals.set(label, (totals.get(label) ?? 0) + readNumber(row, valueKey))
    }
    return [...totals.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value)
}

/** 构造统一结果 */
function buildResult(
    request: WechatStatsQueryRequest,
    beginDate: string,
    endDate: string,
    metrics: WechatStatsMetric[],
    points: WechatStatsDataPoint[],
    breakdowns: WechatStatsBreakdown[],
    items: WechatStatsItem[],
    isDelayed: boolean,
): WechatStatsQueryResult {
    const meta = WECHAT_STATS_VIEW_META[request.view]
    return {
        dimension: request.dimension,
        view: request.view,
        beginDate,
        endDate,
        granularity: meta.granularity,
        metrics,
        points,
        breakdowns,
        items,
        isDelayed,
    }
}

/** 分时数据点标签：YYYY-MM-DD HH:00 → MM-DD HH */
function hourLabel(date: string, hour: number): string {
    return `${date.slice(5)} ${String(hour).padStart(2, '0')}`
}

/** 通用图文阅读指标：getuserread / getuserreadhour / getarticlesummary 共用字段 */
const NEWS_READ_METRICS: readonly MetricDef[] = [
    { key: 'intPageReadUser', label: '图文页阅读人数', format: 'number' },
    { key: 'intPageReadCount', label: '图文页阅读次数', format: 'number' },
    { key: 'oriPageReadUser', label: '原文页阅读人数', format: 'number' },
    { key: 'shareUser', label: '分享人数', format: 'number' },
    { key: 'shareCount', label: '分享次数', format: 'number' },
    { key: 'addToFavUser', label: '收藏人数', format: 'number' },
]

/** 消息类指标：概况 / 分时 / 周 / 月共用 */
const MSG_METRICS: readonly MetricDef[] = [
    { key: 'msgUser', label: '发消息人数', format: 'number' },
    { key: 'msgCount', label: '消息条数', format: 'number' },
]

/** 接口调用指标 */
const API_METRICS: readonly MetricDef[] = [
    { key: 'callbackCount', label: '被动回复次数', format: 'number' },
    { key: 'failCount', label: '回复失败次数', format: 'number' },
    { key: 'avgTimeCost', label: '平均耗时', format: 'duration' },
    { key: 'maxTimeCost', label: '最大耗时', format: 'duration' },
]

export class WechatStatsService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 用户增长概览：保留旧契约，内部走 userDaily / userCumulate 分段查询 */
    public async overview(request: WechatStatsRequest): Promise<WechatStatsResult> {
        const daily = await this.query({
            accountId: request.accountId,
            dimension: 'users',
            view: 'userDaily',
            range: { kind: 'days', days: request.days },
        })
        const cumulate = await this.query({
            accountId: request.accountId,
            dimension: 'users',
            view: 'userCumulate',
            range: { kind: 'days', days: request.days },
        })
        const cumulateByDate = new Map(
            cumulate.points.map((point) => [point.date, point.values.cumulateUsers ?? 0] as const),
        )
        const points: WechatStatsPoint[] = daily.points.map((point) => ({
            date: point.date,
            newUsers: point.values.newUsers ?? 0,
            cancelUsers: point.values.cancelUsers ?? 0,
            netUsers: point.values.netUsers ?? 0,
            cumulateUsers: cumulateByDate.get(point.date) ?? 0,
        }))
        const total = (result: WechatStatsQueryResult, key: string): number =>
            result.metrics.find((metric) => metric.key === key)?.total ?? 0
        return {
            points,
            totalNew: total(daily, 'newUsers'),
            totalCancel: total(daily, 'cancelUsers'),
            totalNet: total(daily, 'netUsers'),
            cumulateUsers: total(cumulate, 'cumulateUsers'),
        }
    }

    /** 分视图查询：按元数据分段取数，再按视图把平台字段映射成统一结构 */
    public async query(request: WechatStatsQueryRequest): Promise<WechatStatsQueryResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const { beginDate, endDate } = readStatsRange(request.range, request.view, new Date())
        const { rows, isDelayed } = await this.collectRows(accessToken, request.view, beginDate, endDate)
        switch (request.view) {
            case 'userDaily':
                return this.readUserDaily(request, beginDate, endDate, rows, isDelayed)
            case 'userCumulate':
                return this.readUserCumulate(request, beginDate, endDate, rows, isDelayed)
            case 'newsSummary':
                return this.readNewsSummary(request, beginDate, endDate, rows, isDelayed)
            case 'newsReadHour':
            case 'newsShareHour':
                return this.readNewsHour(request, beginDate, endDate, rows, isDelayed)
            case 'newsRead':
                return this.readNewsRead(request, beginDate, endDate, rows, isDelayed)
            case 'newsShare':
                return this.readNewsShare(request, beginDate, endDate, rows, isDelayed)
            case 'newsTotal':
                return this.readNewsTotal(request, beginDate, endDate, rows, isDelayed)
            case 'newsBiz':
                return this.readNewsBiz(request, beginDate, endDate, rows, isDelayed)
            case 'newsArticleRead':
                return this.readArticleRead(request, beginDate, endDate, rows, isDelayed)
            case 'newsArticleShare':
                return this.readArticleShare(request, beginDate, endDate, rows, isDelayed)
            case 'newsArticleDetail':
                return this.readArticleDetail(request, beginDate, endDate, rows, isDelayed)
            case 'msgDaily':
            case 'msgHour':
            case 'msgWeek':
            case 'msgMonth':
                return this.readMessage(request, beginDate, endDate, rows, isDelayed)
            case 'msgDist':
            case 'msgDistWeek':
            case 'msgDistMonth':
                return this.readMessageDist(request, beginDate, endDate, rows, isDelayed)
            case 'apiDaily':
            case 'apiHour':
                return this.readApi(request, beginDate, endDate, rows, isDelayed)
        }
    }

    /** 按视图元数据的跨度分段取数，任一分段失败即整体失败，避免展示半截数据 */
    private async collectRows(
        accessToken: string,
        view: WechatStatsView,
        beginDate: string,
        endDate: string,
    ): Promise<{ rows: WechatDatacubeRow[]; isDelayed: boolean }> {
        const maxDays = WECHAT_STATS_VIEW_META[view].maxDays
        const chunks = splitRange(beginDate, endDate, maxDays)
        const results = await Promise.all(
            chunks.map(async (chunk) =>
                fetchDatacube(accessToken, VIEW_ENDPOINTS[view], chunk.beginDate, chunk.endDate),
            ),
        )
        const rows: WechatDatacubeRow[] = []
        let isDelayed = false
        for (const result of results) {
            if (!result.ok) {
                throw new Error(result.message)
            }
            rows.push(...result.data.rows)
            isDelayed = isDelayed || result.data.isDelayed
        }
        return { rows, isDelayed }
    }

    /** 用户增减：按日期汇总，并保留来源分布 */
    private readUserDaily(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        for (const date of dateKeys(beginDate, endDate)) {
            byDate.set(date, { newUsers: 0, cancelUsers: 0, netUsers: 0 })
        }
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            addRow(byDate, date, {
                newUsers: readNumber(row, 'new_user'),
                cancelUsers: readNumber(row, 'cancel_user'),
            })
        }
        for (const row of byDate.values()) {
            row.netUsers = (row.newUsers ?? 0) - (row.cancelUsers ?? 0)
        }
        const defs: readonly MetricDef[] = [
            { key: 'newUsers', label: '新增关注', format: 'number' },
            { key: 'cancelUsers', label: '取消关注', format: 'number' },
            { key: 'netUsers', label: '净增关注', format: 'number' },
        ]
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                defs.map((item) => item.key),
            ),
            makeBreakdowns(rows, 'user_source', 'new_user', USER_SOURCE_LABELS),
            [],
            isDelayed,
        )
    }

    /** 累计用户：存量指标，缺行时沿用最近一次已知值 */
    private readUserCumulate(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length > 0) {
                addRow(byDate, date, { cumulateUsers: readNumber(row, 'cumulate_user') })
            }
        }
        let last = 0
        for (const date of dateKeys(beginDate, endDate)) {
            const current = byDate.get(date) ?? {}
            const reported = current.cumulateUsers ?? 0
            last = reported > 0 ? reported : last
            current.cumulateUsers = last
            byDate.set(date, current)
        }
        const defs: readonly MetricDef[] = [{ key: 'cumulateUsers', label: '累计关注', format: 'number' }]
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, { cumulateUsers: byDate.get(endDate)?.cumulateUsers ?? last }),
            makePoints(beginDate, endDate, byDate, ['cumulateUsers']),
            [],
            [],
            isDelayed,
        )
    }

    /** 图文群发每日：按日期汇总 + 逐篇明细 */
    private readNewsSummary(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        const items: WechatStatsItem[] = []
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const values: Record<string, number> = {}
            for (const def of NEWS_READ_METRICS) {
                values[def.key] = readNumber(row, PLATFORM_NEWS_KEYS[def.key] ?? '')
            }
            addRow(byDate, date, values)
            items.push({
                id: readString(row, 'msgid'),
                title: readString(row, 'title'),
                date,
                values,
            })
        }
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(NEWS_READ_METRICS, totalsFrom(byDate, NEWS_READ_METRICS)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                NEWS_READ_METRICS.map((item) => item.key),
            ),
            [],
            items,
            isDelayed,
        )
    }

    /** 图文阅读 / 转发分时：按小时聚合，并保留来源或场景分布 */
    private readNewsHour(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const label = hourLabel(date, readNumber(row, 'ref_hour'))
            const values: Record<string, number> = {}
            for (const def of NEWS_READ_METRICS) {
                values[def.key] = readNumber(row, PLATFORM_NEWS_KEYS[def.key] ?? '')
            }
            addRow(byDate, label, values)
        }
        const isShare = request.view === 'newsShareHour'
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(NEWS_READ_METRICS, totalsFrom(byDate, NEWS_READ_METRICS)),
            sortedPoints(
                byDate,
                NEWS_READ_METRICS.map((item) => item.key),
            ),
            isShare
                ? makeBreakdowns(rows, 'share_scene', 'share_user', SHARE_SCENE_LABELS)
                : makeBreakdowns(rows, 'user_source', 'int_page_read_user', READ_SOURCE_LABELS),
            [],
            isDelayed,
        )
    }

    /** 图文阅读概况：按日期聚合 + 来源分布 */
    private readNewsRead(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const values: Record<string, number> = {}
            for (const def of NEWS_READ_METRICS) {
                values[def.key] = readNumber(row, PLATFORM_NEWS_KEYS[def.key] ?? '')
            }
            addRow(byDate, date, values)
        }
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(NEWS_READ_METRICS, totalsFrom(byDate, NEWS_READ_METRICS)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                NEWS_READ_METRICS.map((item) => item.key),
            ),
            makeBreakdowns(rows, 'user_source', 'int_page_read_user', READ_SOURCE_LABELS),
            [],
            isDelayed,
        )
    }

    /** 图文转发概况：按日期聚合 + 场景分布 */
    private readNewsShare(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        const defs: readonly MetricDef[] = [
            { key: 'shareUser', label: '分享人数', format: 'number' },
            { key: 'shareCount', label: '分享次数', format: 'number' },
        ]
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            addRow(byDate, date, {
                shareUser: readNumber(row, 'share_user'),
                shareCount: readNumber(row, 'share_count'),
            })
        }
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                defs.map((item) => item.key),
            ),
            makeBreakdowns(rows, 'user_source', 'share_user', READ_SOURCE_LABELS),
            [],
            isDelayed,
        )
    }

    /** 图文群发总数据：details 为逐日数据，按 stat_date 累加；明细的 values 取最后一天的当日值 */
    private readNewsTotal(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        const items: WechatStatsItem[] = []
        for (const row of rows) {
            const publishDate = readString(row, 'ref_date')
            const details = readNestedList(row, 'details')
            const values: Record<string, number> = {}
            for (const def of NEWS_READ_METRICS) {
                values[def.key] = 0
            }
            values.targetUser = 0
            for (const detail of details) {
                const statDate = readString(detail, 'stat_date')
                if (statDate.length === 0) {
                    continue
                }
                const daily: Record<string, number> = { targetUser: readNumber(detail, 'target_user') }
                for (const def of NEWS_READ_METRICS) {
                    daily[def.key] = readNumber(detail, PLATFORM_NEWS_KEYS[def.key] ?? '')
                }
                addRow(byDate, statDate, daily)
                for (const key of Object.keys(values)) {
                    values[key] = daily[key] ?? 0
                }
            }
            items.push({
                id: readString(row, 'msgid'),
                title: readString(row, 'title'),
                date: publishDate,
                values,
            })
        }
        const defs: readonly MetricDef[] = [
            { key: 'targetUser', label: '送达人数', format: 'number' },
            ...NEWS_READ_METRICS,
        ]
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                defs.map((item) => item.key),
            ),
            [],
            items,
            isDelayed,
        )
    }

    /** 发表内容概况：平台已按日期汇总，直接映射八个指标 */
    private readNewsBiz(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        const defs: readonly MetricDef[] = [
            { key: 'readUser', label: '阅读人数', format: 'number' },
            { key: 'shareUser', label: '分享人数', format: 'number' },
            { key: 'zaikanUser', label: '爱心赞人数', format: 'number' },
            { key: 'likeUser', label: '点赞人数', format: 'number' },
            { key: 'commentCount', label: '留言条数', format: 'number' },
            { key: 'collectionUser', label: '收藏人数', format: 'number' },
            { key: 'redirectOriPageUser', label: '跳转原文人数', format: 'number' },
            { key: 'sendPageCount', label: '发布篇数', format: 'number' },
        ]
        const platformKeys: Readonly<Record<string, string>> = {
            readUser: 'read_user',
            shareUser: 'share_user',
            zaikanUser: 'zaikan_user',
            likeUser: 'like_user',
            commentCount: 'comment_count',
            collectionUser: 'collection_user',
            redirectOriPageUser: 'redirect_ori_page_user',
            sendPageCount: 'send_page_count',
        }
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const detail = readNested(row, 'detail')
            const values: Record<string, number> = {}
            for (const def of defs) {
                values[def.key] = readNumber(detail, platformKeys[def.key] ?? '')
            }
            addRow(byDate, date, values)
        }
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                defs.map((item) => item.key),
            ),
            [],
            [],
            isDelayed,
        )
    }

    /** 发表内容每日阅读：按文章聚合，保留来源分布 */
    private readArticleRead(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        return this.readArticleMetric(request, beginDate, endDate, rows, isDelayed, 'read_user', '阅读人数')
    }

    /** 发表内容每日分享：按文章聚合 */
    private readArticleShare(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        return this.readArticleMetric(request, beginDate, endDate, rows, isDelayed, 'share_user', '分享人数')
    }

    /** 发表内容每日指标的共用映射：detail 下取单指标，msgid 作明细 id */
    private readArticleMetric(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
        platformKey: string,
        label: string,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        const items: WechatStatsItem[] = []
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const detail = readNested(row, 'detail')
            const value = readNumber(detail, platformKey)
            addRow(byDate, date, { value })
            items.push({ id: readString(row, 'msgid'), title: readString(row, 'msgid'), date, values: { value } })
        }
        const defs: readonly MetricDef[] = [{ key: 'value', label, format: 'number' }]
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            makePoints(beginDate, endDate, byDate, ['value']),
            [],
            items,
            isDelayed,
        )
    }

    /** 发表内容详细数据：逐篇展开 detail_list，取最新一天的累计指标 */
    private readArticleDetail(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        const items: WechatStatsItem[] = []
        const defs: readonly MetricDef[] = [
            { key: 'readUser', label: '阅读人数', format: 'number' },
            { key: 'shareUser', label: '分享人数', format: 'number' },
            { key: 'zaikanUser', label: '爱心赞人数', format: 'number' },
            { key: 'likeUser', label: '点赞人数', format: 'number' },
            { key: 'commentCount', label: '留言条数', format: 'number' },
            { key: 'collectionUser', label: '收藏人数', format: 'number' },
            { key: 'readSubscribeUser', label: '阅读后关注', format: 'number' },
            { key: 'praiseMoney', label: '赞赏金额（分）', format: 'number' },
        ]
        const platformKeys: Readonly<Record<string, string>> = {
            readUser: 'read_user',
            shareUser: 'share_user',
            zaikanUser: 'zaikan_user',
            likeUser: 'like_user',
            commentCount: 'comment_count',
            collectionUser: 'collection_user',
            readSubscribeUser: 'read_subscribe_user',
            praiseMoney: 'praise_money',
        }
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const details = readNestedList(row, 'detail_list')
            if (details.length === 0) {
                continue
            }
            const ordered = [...details].sort((left, right) =>
                readString(left, 'stat_date').localeCompare(readString(right, 'stat_date')),
            )
            const latest = ordered[ordered.length - 1] ?? {}
            const values: Record<string, number> = {}
            for (const def of defs) {
                values[def.key] = readNumber(latest, platformKeys[def.key] ?? '')
            }
            addRow(byDate, date, values)
            const url = readString(row, 'content_url')
            items.push({
                id: readString(row, 'msgid'),
                title: readString(row, 'title'),
                date,
                values,
                ...(url.length > 0 ? { url } : {}),
            })
        }
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            makePoints(
                beginDate,
                endDate,
                byDate,
                defs.map((item) => item.key),
            ),
            [],
            items,
            isDelayed,
        )
    }

    /** 消息发送：概况 / 分时 / 周 / 月共用映射，按消息类型给出分布 */
    private readMessage(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const isHour = request.view === 'msgHour'
        const byDate: RowsByDate = new Map()
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const label = isHour ? hourLabel(date, readNumber(row, 'ref_hour')) : date
            addRow(byDate, label, {
                msgUser: readNumber(row, 'msg_user'),
                msgCount: readNumber(row, 'msg_count'),
            })
        }
        // 分时与周/月的横轴不连续，补零会让图表几乎全是空档
        const points =
            request.view === 'msgDaily'
                ? makePoints(
                      beginDate,
                      endDate,
                      byDate,
                      MSG_METRICS.map((item) => item.key),
                  )
                : sortedPoints(
                      byDate,
                      MSG_METRICS.map((item) => item.key),
                  )
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(MSG_METRICS, totalsFrom(byDate, MSG_METRICS)),
            points,
            makeBreakdowns(rows, 'msg_type', 'msg_count', MSG_TYPE_LABELS),
            [],
            isDelayed,
        )
    }

    /** 消息发送量分布：日 / 周 / 月共用，按发送量区间拆分 */
    private readMessageDist(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const byDate: RowsByDate = new Map()
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            addRow(byDate, date, { msgUser: readNumber(row, 'msg_user') })
        }
        const defs: readonly MetricDef[] = [{ key: 'msgUser', label: '发消息人数', format: 'number' }]
        const points =
            request.view === 'msgDist'
                ? makePoints(beginDate, endDate, byDate, ['msgUser'])
                : sortedPoints(byDate, ['msgUser'])
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(defs, totalsFrom(byDate, defs)),
            points,
            makeBreakdowns(rows, 'count_interval', 'msg_user', COUNT_INTERVAL_LABELS),
            [],
            isDelayed,
        )
    }

    /** 被动回复：日概况与分时共用，耗时按回复次数加权 */
    private readApi(
        request: WechatStatsQueryRequest,
        beginDate: string,
        endDate: string,
        rows: WechatDatacubeRow[],
        isDelayed: boolean,
    ): WechatStatsQueryResult {
        const isHour = request.view === 'apiHour'
        const byDate: RowsByDate = new Map()
        for (const row of rows) {
            const date = readString(row, 'ref_date')
            if (date.length === 0) {
                continue
            }
            const label = isHour ? hourLabel(date, readNumber(row, 'ref_hour')) : date
            addRow(byDate, label, {
                callbackCount: readNumber(row, 'callback_count'),
                failCount: readNumber(row, 'fail_count'),
                totalTimeCost: readNumber(row, 'total_time_cost'),
                maxTimeCost: readNumber(row, 'max_time_cost'),
            })
        }
        const points: WechatStatsDataPoint[] = [...byDate.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([date, row]) => {
                const callbacks = row.callbackCount ?? 0
                return {
                    date,
                    values: {
                        callbackCount: callbacks,
                        failCount: row.failCount ?? 0,
                        avgTimeCost: callbacks === 0 ? 0 : Math.round((row.totalTimeCost ?? 0) / callbacks),
                        maxTimeCost: row.maxTimeCost ?? 0,
                    },
                }
            })
        const callbacks = sumKey(byDate, 'callbackCount')
        const totalCost = sumKey(byDate, 'totalTimeCost')
        return buildResult(
            request,
            beginDate,
            endDate,
            makeMetrics(API_METRICS, {
                callbackCount: callbacks,
                failCount: sumKey(byDate, 'failCount'),
                avgTimeCost: callbacks === 0 ? 0 : Math.round(totalCost / callbacks),
                maxTimeCost: maxKey(byDate, 'maxTimeCost'),
            }),
            points,
            [],
            [],
            isDelayed,
        )
    }
}

/** 按日期键有序输出数据点，用于分时等不连续粒度 */
function sortedPoints(rows: RowsByDate, keys: readonly string[]): WechatStatsDataPoint[] {
    return [...rows.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, row]) => {
            const values: Record<string, number> = {}
            for (const key of keys) {
                values[key] = row[key] ?? 0
            }
            return { date, values }
        })
}

/** 统一指标 key 到平台字段名的映射：图文阅读类接口共用 */
const PLATFORM_NEWS_KEYS: Readonly<Record<string, string>> = {
    intPageReadUser: 'int_page_read_user',
    intPageReadCount: 'int_page_read_count',
    oriPageReadUser: 'ori_page_read_user',
    shareUser: 'share_user',
    shareCount: 'share_count',
    addToFavUser: 'add_to_fav_user',
}
