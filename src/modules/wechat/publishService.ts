/**
 * 推送服务（草稿阶段）：把批次渲染成公众号 HTML、补传本地图片素材，再提交到草稿箱。
 * 复用约定：渲染走 ./render，素材走 ./materialService，草稿接口走 ./client，落库走 db/issueRepository；
 * 批次摘要复用 issueService.detail，避免这里再拼一套「批次 + 文章」的组装口径。
 * 关键约束：本阶段只生成草稿，不触发群发——群发受主体权限与「订阅号一天一次」频率约束，属独立动作；
 * 单张图片不可用只记警告、不中断整篇；没有可用封面时直接拒绝（平台强制要求 thumb_media_id）；
 * 成功后写回 media_id 并推进到 ready，失败只回写错误、状态停在 draft，用户改完可直接重试；
 * 已推送的批次拒绝重新生成草稿，避免同一内容在草稿箱里堆出多份。
 */
import type { WechatPublishDraftResult } from '@shared/types/wechat'
import { describeDraftError, submitWechatDraft } from './client'
import { findWechatAccount } from './db/accountRepository'
import { findWechatIssue, listWechatArticles, updateWechatIssueDraft } from './db/issueRepository'
import { renderWechatHtml } from './render'
import type { WechatDraftArticle } from './client'
import type { WechatSecretStore } from './credentials'
import type { WechatIssueService } from './issueService'
import type { WechatMaterialService } from './materialService'
import type { WechatTokenService } from './tokenService'
import type Database from 'better-sqlite3'

/** 服务依赖：库、密钥、Token、素材服务与批次服务（复用其摘要组装） */
export interface WechatPublishServiceDeps {
    db: Database.Database
    secrets: WechatSecretStore
    tokens: WechatTokenService
    materials: WechatMaterialService
    issues: WechatIssueService
}

export class WechatPublishService {
    public constructor(private readonly deps: WechatPublishServiceDeps) {}

    /**
     * 生成草稿：渲染 → 补传图片 → draft/add 或 draft/update → 回写状态。
     * 关键约束：warnings 全部来自非阻断问题（外链图片、体积超限、文件缺失），
     * 由前端以 warning 级提示展示，不改变「草稿已生成」这个结论。
     */
    public async publishDraft(issueId: string): Promise<WechatPublishDraftResult> {
        const issue = findWechatIssue(this.deps.db, issueId)
        if (issue === null) {
            throw new Error('推送批次不存在，可能已被删除')
        }
        if (issue.status === 'published') {
            throw new Error('该批次已推送，不能重新生成草稿；如需再发一次，请新建批次')
        }
        const account = findWechatAccount(this.deps.db, issue.account_id)
        if (account === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }
        const articles = listWechatArticles(this.deps.db, issueId)
        if (articles.length === 0) {
            throw new Error('批次里还没有文章，先添加或导入一篇')
        }

        const warnings = new Set<string>()
        const drafts: WechatDraftArticle[] = []
        for (const article of articles) {
            /** 本篇第一张成功上传的图片同时充当封面：平台要求每篇都有 thumb_media_id */
            let coverMediaId: string | null = null
            const rendered = await renderWechatHtml(article.body, {
                resolveImageUrl: async (url: string): Promise<string | null> => {
                    const ensured = await this.deps.materials.ensureImage({
                        accountId: issue.account_id,
                        appId: account.app_id,
                        sourcePath: article.source_path,
                        imageUrl: url,
                    })
                    if (ensured.kind === 'uploaded') {
                        coverMediaId ??= ensured.mediaId
                        return ensured.url
                    }
                    if (ensured.kind === 'external') {
                        warnings.add(`外链图片未上传（可能被微信屏蔽）：${url}`)
                        return null
                    }
                    warnings.add(ensured.reason)
                    return null
                },
            })
            if (coverMediaId === null) {
                throw new Error(`《${article.title}》缺少封面：请在正文放入一张本地 jpg/png 图片后重试`)
            }
            drafts.push({
                title: article.title,
                author: article.author ?? '',
                digest: article.digest ?? '',
                content: rendered.html,
                thumbMediaId: coverMediaId,
                needOpenComment: article.allow_comment === 1,
                onlyFansCanComment: false,
            })
        }

        const appSecret = await this.deps.secrets.read(issue.account_id)
        if (appSecret === undefined || appSecret.length === 0) {
            throw new Error('公众号密钥缺失，无法提交草稿')
        }
        const tokenOutcome = await this.deps.tokens.getToken({
            accountId: issue.account_id,
            appId: account.app_id,
            appSecret,
        })
        if (!tokenOutcome.ok) {
            throw new Error(tokenOutcome.message)
        }

        const existingMediaId = issue.media_id ?? undefined
        const outcome = await submitWechatDraft(tokenOutcome.token.accessToken, drafts, existingMediaId)
        if (!outcome.ok) {
            updateWechatIssueDraft(this.deps.db, {
                id: issue.id,
                mediaId: issue.media_id,
                status: issue.status,
                errorCode: outcome.errorCode,
                errorHint: describeDraftError(outcome.errorCode),
                updatedAt: new Date().toISOString(),
            })
            throw new Error(outcome.message)
        }

        updateWechatIssueDraft(this.deps.db, {
            id: issue.id,
            mediaId: outcome.mediaId,
            status: 'ready',
            errorCode: null,
            errorHint: null,
            updatedAt: new Date().toISOString(),
        })
        const detail = this.deps.issues.detail(issue.id)
        return { issue: detail.issue, warnings: [...warnings] }
    }
}
