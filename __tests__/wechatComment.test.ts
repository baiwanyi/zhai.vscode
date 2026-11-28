/**
 * 留言契约的单元测试：覆盖目标校验、接口端点、错误码归一与分页边界。
 * 收窄函数是协议层入口防线，越界序号与空内容必须在这里被挡住；
 * 端点常量与官方路径绑定，避免回复接口再次漏掉 /add 后缀而整体失效。
 */
import { describe, expect, it } from 'vitest'
import { describeCommentError } from '../src/modules/wechat/client'
import {
    COMMENT_CLOSE_ENDPOINT,
    COMMENT_OPEN_ENDPOINT,
    COMMENT_REPLY_DELETE_ENDPOINT,
    COMMENT_REPLY_ENDPOINT,
} from '../src/modules/wechat/endpoints'
import {
    isWechatCommentArticleRequest,
    isWechatCommentListRequest,
    isWechatCommentMarkRequest,
    isWechatCommentRemoveRequest,
    isWechatCommentReplyRequest,
    isWechatCommentSwitchRequest,
    WECHAT_COMMENT_CONTENT_MAX,
    WECHAT_COMMENT_PAGE_SIZE,
    WECHAT_ISSUE_ARTICLE_LIMIT,
} from '../src/shared/types/wechat'

const ACCOUNT_ID = 'acc-1a2b3c4d5e'
const ISSUE_ID = 'iss-1a2b3c4d5e'

/** 构造合法的目标三元组 */
function target(partial: Record<string, unknown> = {}): Record<string, unknown> {
    return { accountId: ACCOUNT_ID, issueId: ISSUE_ID, sortIndex: 1, ...partial }
}

describe('isWechatCommentListRequest', () => {
    it('接受合法的账号、批次与序号', () => {
        expect(isWechatCommentListRequest(target())).toBe(true)
        expect(isWechatCommentListRequest(target({ sortIndex: WECHAT_ISSUE_ARTICLE_LIMIT }))).toBe(true)
    })

    it('序号从 1 开始，0 与超上限都拒绝', () => {
        expect(isWechatCommentListRequest(target({ sortIndex: 0 }))).toBe(false)
        expect(isWechatCommentListRequest(target({ sortIndex: WECHAT_ISSUE_ARTICLE_LIMIT + 1 }))).toBe(false)
        expect(isWechatCommentListRequest(target({ sortIndex: 1.5 }))).toBe(false)
    })

    it('offset 可选，负数拒绝', () => {
        expect(isWechatCommentListRequest(target({ offset: 0 }))).toBe(true)
        expect(isWechatCommentListRequest(target({ offset: 20 }))).toBe(true)
        expect(isWechatCommentListRequest(target({ offset: -1 }))).toBe(false)
    })

    it('账号或批次 id 非法时拒绝', () => {
        expect(isWechatCommentListRequest(target({ accountId: 'ACC-1' }))).toBe(false)
        expect(isWechatCommentListRequest(target({ issueId: 'iss/../x' }))).toBe(false)
        expect(isWechatCommentListRequest(null)).toBe(false)
        expect(isWechatCommentListRequest('x')).toBe(false)
    })
})

describe('isWechatCommentReplyRequest', () => {
    it('内容非空且不超长时通过', () => {
        expect(isWechatCommentReplyRequest(target({ commentId: 12, content: '谢谢' }))).toBe(true)
        expect(
            isWechatCommentReplyRequest(target({ commentId: 12, content: 'a'.repeat(WECHAT_COMMENT_CONTENT_MAX) })),
        ).toBe(true)
    })

    it('空内容、纯空白与超长内容都拒绝', () => {
        expect(isWechatCommentReplyRequest(target({ commentId: 12, content: '' }))).toBe(false)
        expect(isWechatCommentReplyRequest(target({ commentId: 12, content: '   ' }))).toBe(false)
        expect(
            isWechatCommentReplyRequest(target({ commentId: 12, content: 'a'.repeat(WECHAT_COMMENT_CONTENT_MAX + 1) })),
        ).toBe(false)
    })

    it('留言 id 必须为正整数', () => {
        expect(isWechatCommentReplyRequest(target({ commentId: 0, content: 'x' }))).toBe(false)
        expect(isWechatCommentReplyRequest(target({ commentId: 1.5, content: 'x' }))).toBe(false)
        expect(isWechatCommentReplyRequest(target({ content: 'x' }))).toBe(false)
    })
})

describe('isWechatCommentMarkRequest', () => {
    it('elected 必须是布尔值', () => {
        expect(isWechatCommentMarkRequest(target({ commentId: 1, elected: true }))).toBe(true)
        expect(isWechatCommentMarkRequest(target({ commentId: 1, elected: false }))).toBe(true)
        expect(isWechatCommentMarkRequest(target({ commentId: 1, elected: 1 }))).toBe(false)
        expect(isWechatCommentMarkRequest(target({ commentId: 1 }))).toBe(false)
    })
})

describe('isWechatCommentRemoveRequest', () => {
    it('只要求目标与留言 id 合法', () => {
        expect(isWechatCommentRemoveRequest(target({ commentId: 9 }))).toBe(true)
        expect(isWechatCommentRemoveRequest(target())).toBe(false)
        expect(isWechatCommentRemoveRequest(target({ commentId: '9' }))).toBe(false)
    })
})

describe('isWechatCommentArticleRequest', () => {
    it('只要求账号与批次合法', () => {
        expect(isWechatCommentArticleRequest({ accountId: ACCOUNT_ID, issueId: ISSUE_ID })).toBe(true)
        // 原文按批次定位，不关心文章序号：这里多带的字段不影响判定
        expect(isWechatCommentArticleRequest(target())).toBe(true)
    })

    it('缺字段或 id 非法时拒绝', () => {
        expect(isWechatCommentArticleRequest({ accountId: ACCOUNT_ID })).toBe(false)
        expect(isWechatCommentArticleRequest({ accountId: ACCOUNT_ID, issueId: 'iss/../x' })).toBe(false)
        expect(isWechatCommentArticleRequest({ accountId: 'ACC-1', issueId: ISSUE_ID })).toBe(false)
        expect(isWechatCommentArticleRequest(null)).toBe(false)
    })
})

describe('isWechatCommentSwitchRequest', () => {
    it('目标合法且 enabled 为布尔值时通过', () => {
        expect(isWechatCommentSwitchRequest(target({ enabled: true }))).toBe(true)
        expect(isWechatCommentSwitchRequest(target({ enabled: false }))).toBe(true)
    })

    it('enabled 缺失或类型不符时拒绝', () => {
        expect(isWechatCommentSwitchRequest(target())).toBe(false)
        expect(isWechatCommentSwitchRequest(target({ enabled: 'true' }))).toBe(false)
        expect(isWechatCommentSwitchRequest(target({ enabled: 1 }))).toBe(false)
    })

    it('目标非法时拒绝', () => {
        expect(
            isWechatCommentSwitchRequest({ accountId: ACCOUNT_ID, issueId: ISSUE_ID, sortIndex: 0, enabled: true }),
        ).toBe(false)
        expect(isWechatCommentSwitchRequest(null)).toBe(false)
    })
})

describe('留言接口端点', () => {
    it('回复使用官方 reply/add 路径，删除回复使用 reply/delete', () => {
        expect(COMMENT_REPLY_ENDPOINT).toBe('https://api.weixin.qq.com/cgi-bin/comment/reply/add')
        expect(COMMENT_REPLY_DELETE_ENDPOINT).toBe('https://api.weixin.qq.com/cgi-bin/comment/reply/delete')
    })

    it('评论开关使用官方 open/close 路径', () => {
        expect(COMMENT_OPEN_ENDPOINT).toBe('https://api.weixin.qq.com/cgi-bin/comment/open')
        expect(COMMENT_CLOSE_ENDPOINT).toBe('https://api.weixin.qq.com/cgi-bin/comment/close')
    })

    it('分页条数小于平台拒绝的 50', () => {
        expect(WECHAT_COMMENT_PAGE_SIZE).toBeGreaterThan(0)
        expect(WECHAT_COMMENT_PAGE_SIZE).toBeLessThan(50)
    })
})

describe('describeCommentError', () => {
    it('留言专属码给出可执行的提示，而不是回落鉴权失败', () => {
        expect(describeCommentError(88003)).toContain('上限')
        expect(describeCommentError(88004)).toContain('读者删除')
        expect(describeCommentError(88005)).toContain('已经回复')
        expect(describeCommentError(88007)).toContain('300')
        expect(describeCommentError(88008)).toContain('不存在')
    })

    it('未登记的码回落通用错误表', () => {
        expect(describeCommentError(45009)).toContain('额度')
        expect(describeCommentError(-1)).toContain('繁忙')
        expect(describeCommentError(99999)).toContain('鉴权失败')
    })
})
