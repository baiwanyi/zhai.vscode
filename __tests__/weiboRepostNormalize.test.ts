/**
 * 转发项归一化：点赞数与点赞态按主贴口径读取。
 * 重点锁住三件事——attitudes_count 为 0 时不能回退到别的字段、字符串数字要能解析、
 * attitudes_status 的两种形态（1 / { liked: true }）都要认。
 * 全部为纯逻辑用例：直接调归一化函数，不触网。
 */
import { describe, expect, it } from 'vitest'
import { normalizeWebRepost } from '../src/modules/weibo/reposts/read'

/** 构造一条最小可用的转发项：其余字段走归一化的默认值 */
function buildRaw(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        idstr: '5368144232191355',
        text: '转发附言',
        created_at: 'Sun Nov 22 20:10:45 +0800 2026',
        user: { id: 6305885570, screen_name: '易胖易百万' },
        ...overrides,
    }
}

describe('normalizeWebRepost', () => {
    it('读 attitudes_count 与数字形态的 attitudes_status', () => {
        const repost = normalizeWebRepost(buildRaw({ attitudes_count: 48, attitudes_status: 1 }))
        expect(repost?.likes).toBe(48)
        expect(repost?.isLiked).toBe(true)
    })

    it('读对象形态的 attitudes_status，未赞时为 false', () => {
        const liked = normalizeWebRepost(buildRaw({ attitudes_count: 3, attitudes_status: { liked: true } }))
        expect(liked?.likes).toBe(3)
        expect(liked?.isLiked).toBe(true)

        const notLiked = normalizeWebRepost(buildRaw({ attitudes_count: 3, attitudes_status: { liked: false } }))
        expect(notLiked?.isLiked).toBe(false)
    })

    it('计数为 0 时不回退到其它字段，字符串数字能解析', () => {
        const zero = normalizeWebRepost(buildRaw({ attitudes_count: 0, like_counts: 9 }))
        expect(zero?.likes).toBe(0)

        const text = normalizeWebRepost(buildRaw({ attitudes_count: '12' }))
        expect(text?.likes).toBe(12)
    })

    it('字段全缺时计数为 null（与真实 0 区分）、点赞态未赞', () => {
        const repost = normalizeWebRepost(buildRaw({}))
        expect(repost?.likes).toBeNull()
        expect(repost?.isLiked).toBe(false)
    })

    it('原博赞数单独取 retweeted_status，缺失为 null', () => {
        const withOriginal = normalizeWebRepost(
            buildRaw({ attitudes_count: 0, retweeted_status: { attitudes_count: 82_833 } }),
        )
        expect(withOriginal?.likes).toBe(0)
        expect(withOriginal?.originalLikes).toBe(82_833)

        const withoutOriginal = normalizeWebRepost(buildRaw({}))
        expect(withoutOriginal?.originalLikes).toBeNull()
    })
})
