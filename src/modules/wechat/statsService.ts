/**
 * 数据统计服务：用户增长（新增 / 取消 / 净增 / 累计）。
 * 复用约定：Token 走 accountToken，接口走 openapi（新增与累计两个 datacube 接口）；
 * 日期区间只接受 7 / 15 / 30 三档，且结束日期取「昨天」——当天的数据平台尚未结算，
 * 拉今天只会得到空行，反而让用户以为掉数据。
 * 关键约束：datacube 需认证主体，未认证会返回 48001，本层不吞错，统一抛给界面做权限说明；
 * 新增与累计按日期左连接合并：某天没有新增时仍保留累计点，趋势图才不会断。
 */
import type { WechatStatsPoint, WechatStatsRequest, WechatStatsResult } from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { fetchWechatUserCumulate, fetchWechatUserSummary } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

/** 日期键：datacube 按账号所在时区返回 YYYY-MM-DD，这里用本地日期对齐 */
function toDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${String(date.getFullYear())}-${month}-${day}`
}

/** 计算统计区间：结束日期为昨天（当天数据未结算） */
export function readStatsRange(days: 7 | 15 | 30, now: Date): { beginDate: string; endDate: string } {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const begin = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1))
    return { beginDate: toDateKey(begin), endDate: toDateKey(end) }
}

export class WechatStatsService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 用户增长概览：区间内逐日数据 + 汇总 */
    public async overview(request: WechatStatsRequest): Promise<WechatStatsResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const { beginDate, endDate } = readStatsRange(request.days, new Date())

        const [summary, cumulate] = await Promise.all([
            fetchWechatUserSummary(accessToken, beginDate, endDate),
            fetchWechatUserCumulate(accessToken, beginDate, endDate),
        ])
        if (!summary.ok) {
            throw new Error(summary.message)
        }
        if (!cumulate.ok) {
            throw new Error(cumulate.message)
        }

        const cumulateByDate = new Map(cumulate.data.map((row) => [row.date, row.cumulateUsers]))
        const dates = [...new Set([...summary.data.map((row) => row.date), ...cumulateByDate.keys()])].sort()
        const points: WechatStatsPoint[] = dates.map((date) => {
            const row = summary.data.find((item) => item.date === date)
            const newUsers = row?.newUsers ?? 0
            const cancelUsers = row?.cancelUsers ?? 0
            return {
                date,
                newUsers,
                cancelUsers,
                netUsers: newUsers - cancelUsers,
                cumulateUsers: cumulateByDate.get(date) ?? 0,
            }
        })

        const totalNew = points.reduce((sum, point) => sum + point.newUsers, 0)
        const totalCancel = points.reduce((sum, point) => sum + point.cancelUsers, 0)
        const last = points[points.length - 1]
        return {
            points,
            totalNew,
            totalCancel,
            totalNet: totalNew - totalCancel,
            cumulateUsers: last?.cumulateUsers ?? 0,
        }
    }
}
