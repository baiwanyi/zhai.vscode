/**
 * 群发额度计算的单元测试：覆盖订阅号按自然日、服务号按自然月，以及跨日跨月不计入。
 * 全部用本地时间构造记录（无 Z 后缀 / 用本地构造函数），断言不依赖运行机器时区。
 * 不测网络与落库：额度只读已成功推送的时间列表，网络失败由 publishService 承担。
 */
import { describe, expect, it } from 'vitest'
import { readPublishQuota } from '../../src/modules/wechat/publishService'

/** 固定的"现在"：2026-10-31 10:00（本地时区） */
const NOW = new Date(2026, 9, 31, 10, 0, 0)

/** 构造某天某时的 ISO 字符串 */
function at(year: number, month: number, day: number, hour = 9): string {
    return new Date(year, month - 1, day, hour, 0, 0).toISOString()
}

describe('readPublishQuota 订阅号', () => {
    it('今日尚未群发时剩余 1 次', () => {
        const quota = readPublishQuota('subscription', [], NOW)
        expect(quota).toMatchObject({ limit: 1, used: 0, remaining: 1 })
        expect(quota.reason).toContain('今日尚未群发')
    })

    it('今日已群发时剩余 0 并提示恢复时间', () => {
        const quota = readPublishQuota('subscription', [at(2026, 10, 31)], NOW)
        expect(quota).toMatchObject({ used: 1, remaining: 0 })
        expect(quota.reason).toContain('明天')
    })

    it('昨天的记录不计入今日额度', () => {
        const quota = readPublishQuota('subscription', [at(2026, 10, 30)], NOW)
        expect(quota).toMatchObject({ used: 0, remaining: 1 })
    })
})

describe('readPublishQuota 服务号', () => {
    it('本月可群发 4 次，按已推送条数递减', () => {
        const times = [at(2026, 10, 1), at(2026, 10, 8), at(2026, 10, 20)]
        const quota = readPublishQuota('service', times, NOW)
        expect(quota).toMatchObject({ limit: 4, used: 3, remaining: 1 })
        expect(quota.reason).toContain('本月剩余 1 次')
    })

    it('本月已用满时剩余 0', () => {
        const times = [at(2026, 10, 1), at(2026, 10, 8), at(2026, 10, 20), at(2026, 10, 30)]
        const quota = readPublishQuota('service', times, NOW)
        expect(quota).toMatchObject({ used: 4, remaining: 0 })
    })

    it('上月记录不计入本月额度', () => {
        const times = [at(2026, 9, 1), at(2026, 9, 15), at(2026, 10, 2)]
        const quota = readPublishQuota('service', times, NOW)
        expect(quota).toMatchObject({ used: 1, remaining: 3 })
    })
})

describe('readPublishQuota 脏数据', () => {
    it('无法解析的时间串被跳过，不虚增已用次数', () => {
        const quota = readPublishQuota('subscription', ['not-a-date', ''], NOW)
        expect(quota).toMatchObject({ used: 0, remaining: 1 })
    })
})
