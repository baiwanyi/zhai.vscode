/**
 * 微博屏蔽名单测试：覆盖文本解析、名单归一化、追加去重与用户名 / 关键字匹配。
 * 全部为纯函数断言，不触网、不依赖 React。
 */
import { describe, expect, it } from 'vitest'
import {
    WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH,
    type WeiboTimelineMedia,
    type WeiboTimelinePost,
} from '../src/shared/types/weibo'
import {
    addWeiboBlockedUser,
    EMPTY_WEIBO_BLOCK_RULES,
    filterWeiboPosts,
    formatWeiboBlockListText,
    isWeiboPostBlocked,
    normalizeWeiboBlockList,
    parseWeiboBlockListText,
} from '../src/shared/utils/weiboBlock'

const EMPTY_MEDIA: WeiboTimelineMedia = {
    items: [],
    images: [],
    imageIds: [],
    thumbnails: [],
    sizes: [],
    videoUrl: null,
    imageCount: 0,
    videoCount: 0,
}

/** 构造一张最小微博卡片：只填与屏蔽判定相关的字段 */
function makePost(options: { author?: string; text?: string; retweetedText?: string }): WeiboTimelinePost {
    const text = options.text ?? ''
    const retweetedText = options.retweetedText
    return {
        id: '1',
        mblogid: 'abc123',
        url: 'https://weibo.com/1/abc123',
        text,
        segments: [{ type: 'text', text }],
        createdAt: '',
        createdAtRaw: '',
        source: '',
        author: { id: '1', name: options.author ?? '', avatarUrl: '', isVerified: false, isFollowing: false },
        metrics: { reposts: 0, comments: 0, likes: 0 },
        media: EMPTY_MEDIA,
        retweeted:
            retweetedText === undefined
                ? null
                : {
                      id: '2',
                      authorId: '2',
                      authorName: '被转发者',
                      authorIsVerified: false,
                      text: retweetedText,
                      segments: [{ type: 'text', text: retweetedText }],
                      url: 'https://weibo.com/2/def456',
                      createdAt: '',
                      createdAtRaw: '',
                      media: EMPTY_MEDIA,
                      isLongText: false,
                  },
        isLiked: false,
        isLongText: false,
        readsCount: null,
    }
}

describe('parseWeiboBlockListText', () => {
    it('一行一项，去掉空白与空行', () => {
        expect(parseWeiboBlockListText('  张三 \n\n  关键字  \n')).toEqual(['张三', '关键字'])
    })

    it('重复项按不区分大小写去重，保留首次出现的写法', () => {
        expect(parseWeiboBlockListText('Alice\nalice\nALICE')).toEqual(['Alice'])
    })

    it('超长项按上限截断而不是整份丢弃', () => {
        const [item] = parseWeiboBlockListText('x'.repeat(WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH + 20))
        expect(item).toHaveLength(WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH)
    })

    it('与 format 往返一致', () => {
        const text = '张三\n抽奖'
        expect(formatWeiboBlockListText(parseWeiboBlockListText(text))).toBe(text)
    })
})

describe('normalizeWeiboBlockList', () => {
    it('空名单归一化为空数组', () => {
        expect(normalizeWeiboBlockList(['', '   '])).toEqual([])
    })
})

describe('addWeiboBlockedUser', () => {
    it('追加新用户名', () => {
        expect(addWeiboBlockedUser(EMPTY_WEIBO_BLOCK_RULES, ' 张三 ').blockedUsers).toEqual(['张三'])
    })

    it('已在名单里时原样返回，调用方据此跳过写盘', () => {
        const rules = { blockedUsers: ['张三'], blockedKeywords: [] }
        expect(addWeiboBlockedUser(rules, '张三')).toBe(rules)
    })

    it('空名字不改变名单', () => {
        expect(addWeiboBlockedUser(EMPTY_WEIBO_BLOCK_RULES, '   ')).toBe(EMPTY_WEIBO_BLOCK_RULES)
    })
})

describe('isWeiboPostBlocked', () => {
    it('作者名精确命中即屏蔽，忽略大小写与首尾空白', () => {
        const rules = { blockedUsers: ['  Alice '], blockedKeywords: [] }
        expect(isWeiboPostBlocked(makePost({ author: 'alice' }), rules)).toBe(true)
    })

    it('作者名只做整串匹配，不做子串包含', () => {
        const rules = { blockedUsers: ['张三'], blockedKeywords: [] }
        expect(isWeiboPostBlocked(makePost({ author: '张三丰' }), rules)).toBe(false)
    })

    it('正文包含关键字即屏蔽，忽略大小写', () => {
        const rules = { blockedUsers: [], blockedKeywords: ['抽奖'] }
        expect(isWeiboPostBlocked(makePost({ text: '转发参加抽奖活动' }), rules)).toBe(true)
    })

    it('转发正文命中关键字同样屏蔽', () => {
        const rules = { blockedUsers: [], blockedKeywords: ['抽奖'] }
        expect(isWeiboPostBlocked(makePost({ text: '转发微博', retweetedText: '抽奖送书' }), rules)).toBe(true)
    })

    it('空规则一律不屏蔽', () => {
        expect(isWeiboPostBlocked(makePost({ author: '张三', text: '抽奖' }), EMPTY_WEIBO_BLOCK_RULES)).toBe(false)
    })
})

describe('filterWeiboPosts', () => {
    it('规则为空时原样返回入参，保持引用稳定', () => {
        const posts = [makePost({ author: '张三' })]
        expect(filterWeiboPosts(posts, EMPTY_WEIBO_BLOCK_RULES)).toBe(posts)
    })

    it('按用户名与关键字过滤后保持原顺序', () => {
        const posts = [
            makePost({ author: '张三' }),
            makePost({ author: '李四' }),
            makePost({ author: '王五', text: '抽奖' }),
        ]
        const rules = { blockedUsers: ['张三'], blockedKeywords: ['抽奖'] }
        expect(filterWeiboPosts(posts, rules)).toEqual([posts[1]])
    })
})
