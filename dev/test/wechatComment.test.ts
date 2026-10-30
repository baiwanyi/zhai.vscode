/**
 * 留言契约的单元测试：覆盖「账号 + 批次 + 文章序号」的目标校验与各动作的专属字段。
 * 纯函数测试：收窄函数是唯一的入口防线，越界序号与空内容必须在协议层就被挡住。
 * 关注点是边界值：sortIndex 从 1 开始、上限为批次容量；留言 id 必须为正整数。
 */
import { describe, expect, it } from 'vitest'
import {
    isWechatCommentListRequest,
    isWechatCommentMarkRequest,
    isWechatCommentRemoveRequest,
    isWechatCommentReplyRequest,
    WECHAT_COMMENT_CONTENT_MAX,
    WECHAT_ISSUE_ARTICLE_LIMIT,
} from '../../src/shared/types/wechat'

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
