/**
 * 推送批次与文章契约的单元测试：覆盖文本规整、平台上限与请求收窄。
 * 纯函数测试，不触网、不落库、不弹选择器；批次服务里的导入流程依赖 vscode 与索引库，留待集成验证。
 * 断言集中在「哪些输入被拒绝」与「截断是否发生」两处，避免只验证快乐路径。
 */
import { describe, expect, it } from 'vitest'
import {
    isWechatArticleBody,
    isWechatArticleCreateRequest,
    isWechatArticleImportRequest,
    isWechatArticleRemoveRequest,
    isWechatArticleUpdateRequest,
    isWechatIssueCreateRequest,
    isWechatIssueDetailRequest,
    isWechatIssueRemoveRequest,
    isWechatIssuesRequest,
    readWechatArticleAuthor,
    readWechatArticleDigest,
    readWechatArticleTitle,
    WECHAT_ARTICLE_AUTHOR_MAX,
    WECHAT_ARTICLE_BODY_MAX,
    WECHAT_ARTICLE_DIGEST_MAX,
    WECHAT_ARTICLE_TITLE_MAX,
    isWechatCoverPreviewRequest,
    isWechatIssuesMergeRequest,
    isWechatIssuesRemoveBatchRequest,
    isWechatPublishProgress,
} from '../../src/shared/types/wechat'

/** 合法账号与批次 id：与宿主生成的短 id 同形态 */
const ACCOUNT_ID = 'acc-1a2b3c4d5e'
const ISSUE_ID = 'iss-1a2b3c4d5e'
/** 第二个批次 id：合并用例需要区分源与目标 */
const OTHER_ISSUE_ID = 'iss-6f7a8b9c0d'
const ARTICLE_ID = 'art-1a2b3c4d5e'

describe('文本规整', () => {
    it('标题折叠空白并截断到 64 字', () => {
        expect(readWechatArticleTitle('  多行\n标题  ')).toBe('多行 标题')
        expect(readWechatArticleTitle('a'.repeat(WECHAT_ARTICLE_TITLE_MAX + 5))).toHaveLength(WECHAT_ARTICLE_TITLE_MAX)
    })

    it('作者截断到 8 字', () => {
        expect(readWechatArticleAuthor('某某某某某某某某某某')).toHaveLength(WECHAT_ARTICLE_AUTHOR_MAX)
    })

    it('摘要折叠换行并截断到 120 字', () => {
        expect(readWechatArticleDigest('第一行\n第二行')).toBe('第一行 第二行')
        expect(readWechatArticleDigest('b'.repeat(WECHAT_ARTICLE_DIGEST_MAX + 5))).toHaveLength(
            WECHAT_ARTICLE_DIGEST_MAX,
        )
    })

    it('非字符串输入回落空串，由调用方判空', () => {
        expect(readWechatArticleTitle(undefined)).toBe('')
        expect(readWechatArticleAuthor(123)).toBe('')
    })
})

describe('isWechatArticleBody', () => {
    it('恰好等于上限时通过，超出即拒绝', () => {
        expect(isWechatArticleBody('a'.repeat(WECHAT_ARTICLE_BODY_MAX))).toBe(true)
        expect(isWechatArticleBody('a'.repeat(WECHAT_ARTICLE_BODY_MAX + 1))).toBe(false)
    })

    it('非字符串一律拒绝', () => {
        expect(isWechatArticleBody(undefined)).toBe(false)
    })
})

describe('批次请求收窄', () => {
    it('按账号列举批次要求合法 accountId', () => {
        expect(isWechatIssuesRequest({ accountId: ACCOUNT_ID })).toBe(true)
        expect(isWechatIssuesRequest({ accountId: 'ACC-1' })).toBe(false)
        expect(isWechatIssuesRequest({})).toBe(false)
    })

    it('新建批次的标题可缺省', () => {
        expect(isWechatIssueCreateRequest({ accountId: ACCOUNT_ID })).toBe(true)
        expect(isWechatIssueCreateRequest({ accountId: ACCOUNT_ID, title: '十月刊' })).toBe(true)
        expect(isWechatIssueCreateRequest({ accountId: ACCOUNT_ID, title: 1 })).toBe(false)
    })

    it('详情与删除共用批次 id 收窄', () => {
        expect(isWechatIssueDetailRequest({ id: ISSUE_ID })).toBe(true)
        expect(isWechatIssueRemoveRequest({ id: ISSUE_ID })).toBe(true)
        expect(isWechatIssueRemoveRequest({ id: 'iss/../x' })).toBe(false)
    })
})

describe('文章请求收窄', () => {
    it('新建文章：标题必填，正文可缺省', () => {
        expect(isWechatArticleCreateRequest({ issueId: ISSUE_ID, title: '标题' })).toBe(true)
        expect(isWechatArticleCreateRequest({ issueId: ISSUE_ID, title: '   ' })).toBe(false)
        expect(isWechatArticleCreateRequest({ issueId: ISSUE_ID })).toBe(false)
    })

    it('新建文章：正文超限时拒绝', () => {
        expect(
            isWechatArticleCreateRequest({
                issueId: ISSUE_ID,
                title: '标题',
                body: 'a'.repeat(WECHAT_ARTICLE_BODY_MAX + 1),
            }),
        ).toBe(false)
    })

    it('更新文章：正文必填', () => {
        expect(isWechatArticleUpdateRequest({ id: ARTICLE_ID, title: '标题', body: '' })).toBe(true)
        expect(isWechatArticleUpdateRequest({ id: ARTICLE_ID, title: '标题' })).toBe(false)
    })

    it('封面路径为可选字符串，类型不符即拒绝', () => {
        expect(
            isWechatArticleCreateRequest({
                issueId: ISSUE_ID,
                title: '标题',
                coverPath: 'images/202610/cover.png',
            }),
        ).toBe(true)
        expect(isWechatArticleCreateRequest({ issueId: ISSUE_ID, title: '标题', coverPath: 1 })).toBe(false)
        expect(
            isWechatArticleUpdateRequest({ id: ARTICLE_ID, title: '标题', body: '', coverPath: 'images/a.png' }),
        ).toBe(true)
        expect(isWechatArticleUpdateRequest({ id: ARTICLE_ID, title: '标题', body: '', coverPath: null })).toBe(false)
    })

    it('删除文章要求合法 id', () => {
        expect(isWechatArticleRemoveRequest({ id: ARTICLE_ID })).toBe(true)
        expect(isWechatArticleRemoveRequest({ id: 1 })).toBe(false)
    })

    it('推送进度载荷逐字段收窄', () => {
        expect(
            isWechatPublishProgress({
                kind: 'progress',
                issueId: ISSUE_ID,
                stage: 'render',
                message: '渲染第 1/2 篇',
            }),
        ).toBe(true)
        expect(isWechatPublishProgress({ kind: 'progress', issueId: ISSUE_ID, stage: 'nope', message: 'x' })).toBe(
            false,
        )
        expect(isWechatPublishProgress({ kind: 'progress', issueId: ISSUE_ID, stage: 'render', message: '' })).toBe(
            false,
        )
        expect(isWechatPublishProgress({ kind: 'other', issueId: ISSUE_ID, stage: 'render', message: 'x' })).toBe(false)
        expect(isWechatPublishProgress(null)).toBe(false)
    })

    it('批次合并要求 1~20 个源批次，且目标不在源列表内', () => {
        expect(isWechatIssuesMergeRequest({ ids: [ISSUE_ID], targetId: OTHER_ISSUE_ID })).toBe(true)
        expect(isWechatIssuesMergeRequest({ ids: [], targetId: OTHER_ISSUE_ID })).toBe(false)
        expect(isWechatIssuesMergeRequest({ ids: [ISSUE_ID], targetId: ISSUE_ID })).toBe(false)
        expect(
            isWechatIssuesMergeRequest({
                ids: Array.from({ length: 21 }, () => ISSUE_ID),
                targetId: OTHER_ISSUE_ID,
            }),
        ).toBe(false)
        expect(isWechatIssuesMergeRequest({ ids: [ISSUE_ID], targetId: 'bad id' })).toBe(false)
    })

    it('批量删除只接受 1~50 个合法批次 id', () => {
        expect(isWechatIssuesRemoveBatchRequest({ ids: [ISSUE_ID] })).toBe(true)
        expect(isWechatIssuesRemoveBatchRequest({ ids: [] })).toBe(false)
        expect(isWechatIssuesRemoveBatchRequest({ ids: ['bad id'] })).toBe(false)
        expect(isWechatIssuesRemoveBatchRequest({ ids: Array.from({ length: 51 }, () => ISSUE_ID) })).toBe(false)
    })

    it('封面预览只接受 1~20 个非空路径', () => {
        expect(isWechatCoverPreviewRequest({ paths: ['images/202610/a.png'] })).toBe(true)
        expect(isWechatCoverPreviewRequest({ paths: [] })).toBe(false)
        expect(isWechatCoverPreviewRequest({ paths: [''] })).toBe(false)
        expect(
            isWechatCoverPreviewRequest({ paths: Array.from({ length: 21 }, (_, index) => `a${String(index)}.png`) }),
        ).toBe(false)
    })

    it('导入只接受 note 与 press 两个来源', () => {
        expect(isWechatArticleImportRequest({ issueId: ISSUE_ID, sourceKind: 'note' })).toBe(true)
        expect(isWechatArticleImportRequest({ issueId: ISSUE_ID, sourceKind: 'press' })).toBe(true)
        expect(isWechatArticleImportRequest({ issueId: ISSUE_ID, sourceKind: 'manual' })).toBe(false)
        expect(isWechatArticleImportRequest({ issueId: ISSUE_ID })).toBe(false)
    })
})
