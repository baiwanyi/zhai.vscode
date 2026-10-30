/**
 * 推送服务：先把批次渲染成公众号 HTML、补传本地图片素材并提交草稿箱，再按额度正式群发。
 * 复用约定：渲染走 ./render，素材走 ./materialService，草稿与发布接口走 ./client，落库走 db/issueRepository；
 * 批次摘要复用 issueService.detail，避免这里再拼一套「批次 + 文章」的组装口径。
 * 关键约束：草稿与群发是两个动作——群发需已有 media_id，且受主体权限与「订阅号一天一次、服务号一月四次」约束；
 * 单张图片不可用只记警告、不中断整篇；没有可用封面时直接拒绝（平台强制要求 thumb_media_id）；
 * 草稿成功写回 media_id 并推进到 ready，失败只回写错误、状态停在 draft；
 * 群发提交成功只代表任务受理，是否发布成功以 freepublish/get 的轮询结果为准，轮询未出结果时保持 pushing；
 * 已推送的批次拒绝重新生成草稿或重复群发，避免同一内容在平台侧堆出多份。
 */
import {
    readWechatAccountType,
    type WechatAccountType,
    type WechatPublishDraftResult,
    type WechatPublishProgress,
    type WechatPublishQuotaResult,
    type WechatPublishResult,
} from '@shared/types/wechat'
import { describeDraftError, fetchWechatPublishState, submitWechatDraft, submitWechatFreepublish } from './client'
import { findWechatAccount } from './db/accountRepository'
import {
    findWechatIssue,
    listWechatArticles,
    listWechatPublishedTimes,
    updateWechatIssueDraft,
    updateWechatIssuePublish,
} from './db/issueRepository'
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

/** 群发额度：订阅号每个自然日 1 次，服务号每个自然月 4 次（平台规则） */
const SUBSCRIPTION_DAILY_LIMIT = 1
const SERVICE_MONTHLY_LIMIT = 4

/** 群发结果轮询：平台异步发布，间隔 1.5 秒最多查 5 次，超出后保持 pushing 交给后台确认 */
const PUBLISH_POLL_INTERVAL_MS = 1500
const PUBLISH_POLL_ATTEMPTS = 5

/** 本地自然日键：额度按用户所在时区的自然日重置，不能用 UTC */
function localDayKey(date: Date): string {
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1)}-${String(date.getDate())}`
}

/** 本地自然月键：服务号按自然月计额度 */
function localMonthKey(date: Date): string {
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1)}`
}

/**
 * 计算群发额度：按账号类型取周期（日 / 月），统计周期内已成功推送的批次数。
 * 关键约束：只统计 published 状态的记录，失败与被删除的不占额度；
 * reason 在额度用尽时给出恢复时间，正常时说明周期规则，供确认弹窗原样展示。
 */
export function readPublishQuota(
    accountType: WechatAccountType,
    publishedTimes: string[],
    now: Date,
): WechatPublishQuotaResult {
    const isService = accountType === 'service'
    const limit = isService ? SERVICE_MONTHLY_LIMIT : SUBSCRIPTION_DAILY_LIMIT
    const currentKey = isService ? localMonthKey(now) : localDayKey(now)
    const used = publishedTimes.filter((iso) => {
        const time = new Date(iso)
        if (Number.isNaN(time.getTime())) {
            return false
        }
        return (isService ? localMonthKey(time) : localDayKey(time)) === currentKey
    }).length
    const remaining = Math.max(limit - used, 0)
    const reason = isService
        ? `服务号每个自然月可群发 ${String(limit)} 次，本月剩余 ${String(remaining)} 次`
        : remaining > 0
          ? `订阅号每个自然日可群发 ${String(limit)} 次，今日尚未群发`
          : '订阅号每个自然日只能群发 1 次，今日额度已用完，明天 0 点后恢复'
    return { limit, used, remaining, reason }
}

export class WechatPublishService {
    /** 进行中的推送任务：键为批次 id，仅进程内有效 */
    private readonly running = new Map<string, WechatPublishProgress>()

    public constructor(private readonly deps: WechatPublishServiceDeps) {}

    /**
     * 生成草稿：渲染 → 补传图片 → draft/add 或 draft/update → 回写状态。
     * 关键约束：warnings 全部来自非阻断问题（外链图片、体积超限、文件缺失），
     * 由前端以 warning 级提示展示，不改变「草稿已生成」这个结论。
     */
    public async publishDraft(
        issueId: string,
        onProgress?: (progress: WechatPublishProgress) => void,
    ): Promise<WechatPublishDraftResult> {
        return this.withTask(
            issueId,
            {
                kind: 'progress',
                issueId,
                stage: 'render',
                message: '准备生成草稿',
            },
            () => this.runPublishDraft(issueId, onProgress),
        )
    }

    /** 进行中的推送任务：任意页面可查询，用于切走后回来仍能看到「在跑什么」 */
    public listTasks(): WechatPublishProgress[] {
        return [...this.running.values()]
    }

    /**
     * 任务包装：登记进行中任务并在结束时清理（含抛错与提前返回）。
     * 关键约束：不做跨进程持久化——宿主重启后任务表为空，
     * 卡在 pushing 的历史批次由启动时的超时回收处理，两者互补。
     */
    private async withTask<T>(issueId: string, initial: WechatPublishProgress, run: () => Promise<T>): Promise<T> {
        this.running.set(issueId, initial)
        try {
            return await run()
        } finally {
            this.running.delete(issueId)
        }
    }

    /** 播报进度：同时更新任务表与调用方回调，避免两处状态不一致 */
    private report(
        issueId: string,
        onProgress: ((progress: WechatPublishProgress) => void) | undefined,
        progress: WechatPublishProgress,
    ): void {
        this.running.set(issueId, progress)
        onProgress?.(progress)
    }

    /** 草稿提交的实际流程：由 publishDraft 包一层任务登记 */
    private async runPublishDraft(
        issueId: string,
        onProgress?: (progress: WechatPublishProgress) => void,
    ): Promise<WechatPublishDraftResult> {
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
        /** 素材阶段只播报一次：逐张图播报会把界面刷成噪音 */
        let hasReportedMaterial = false
        for (const [index, article] of articles.entries()) {
            this.report(issueId, onProgress, {
                kind: 'progress',
                issueId,
                stage: 'render',
                message: `渲染第 ${String(index + 1)}/${String(articles.length)} 篇`,
            })
            /**
             * 封面优先级：用户指定的封面图 → 正文第一张可用图片。
             * 平台要求每篇都有 thumb_media_id，两者都没有时直接拒绝，避免提交后被平台打回。
             */
            let coverMediaId: string | null = null
            if (article.cover_path !== null && article.cover_path.length > 0) {
                const cover = await this.deps.materials.ensureImage({
                    accountId: issue.account_id,
                    appId: account.app_id,
                    // 封面路径按存储根口径解析，不跟随源文档目录
                    sourcePath: null,
                    imageUrl: article.cover_path,
                })
                if (cover.kind === 'uploaded') {
                    coverMediaId = cover.mediaId
                } else {
                    const reason = cover.kind === 'missing' ? cover.reason : '外链封面无法上传'
                    warnings.add(`《${article.title}》的封面不可用：${reason}`)
                }
            }
            const rendered = await renderWechatHtml(article.body, {
                resolveImageUrl: async (url: string): Promise<string | null> => {
                    if (!hasReportedMaterial) {
                        hasReportedMaterial = true
                        this.report(issueId, onProgress, {
                            kind: 'progress',
                            issueId,
                            stage: 'material',
                            message: '上传图片素材',
                        })
                    }
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
                throw new Error(`《${article.title}》缺少封面：请在文章里指定封面图，或在正文放入一张本地 jpg/png 图片`)
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

        this.report(issueId, onProgress, {
            kind: 'progress',
            issueId,
            stage: 'draft',
            message: `提交草稿（${String(drafts.length)} 篇）`,
        })
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

    /** 查询账号当前群发额度：确认弹窗据此展示剩余次数与周期规则 */
    public quota(accountId: string): WechatPublishQuotaResult {
        const account = findWechatAccount(this.deps.db, accountId)
        if (account === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }
        return readPublishQuota(
            readWechatAccountType(account.account_type),
            listWechatPublishedTimes(this.deps.db, accountId),
            new Date(),
        )
    }

    /**
     * 正式群发：提交 freepublish 并轮询结果。
     * 关键约束：本地额度先拦一层（给出可执行恢复时间），平台侧再拦（48001 未认证、45009 超额），
     * 两层都拦时以平台提示为准；提交成功只代表任务受理，轮询未出结果时保持 pushing，
     * 不臆断成功或失败，让用户到公众号后台确认。
     */
    public async publish(
        issueId: string,
        onProgress?: (progress: WechatPublishProgress) => void,
    ): Promise<WechatPublishResult> {
        return this.withTask(issueId, { kind: 'progress', issueId, stage: 'submit', message: '准备群发' }, () =>
            this.runPublish(issueId, onProgress),
        )
    }

    /** 群发的实际流程：由 publish 包一层任务登记 */
    private async runPublish(
        issueId: string,
        onProgress?: (progress: WechatPublishProgress) => void,
    ): Promise<WechatPublishResult> {
        const issue = findWechatIssue(this.deps.db, issueId)
        if (issue === null) {
            throw new Error('推送批次不存在，可能已被删除')
        }
        if (issue.status === 'published') {
            throw new Error('该批次已推送，不能重复群发')
        }
        if (issue.media_id === null || issue.media_id.length === 0) {
            throw new Error('请先生成草稿，草稿就绪后才能群发')
        }
        const account = findWechatAccount(this.deps.db, issue.account_id)
        if (account === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }

        const quota = this.quota(account.id)
        if (quota.remaining <= 0) {
            throw new Error(quota.reason)
        }

        const appSecret = await this.deps.secrets.read(account.id)
        if (appSecret === undefined || appSecret.length === 0) {
            throw new Error('公众号密钥缺失，无法群发')
        }

        const pushingAt = new Date().toISOString()
        updateWechatIssuePublish(this.deps.db, {
            id: issue.id,
            status: 'pushing',
            publishId: issue.publish_id,
            msgDataId: issue.msg_data_id,
            articleUrl: null,
            publishedAt: null,
            errorCode: null,
            errorHint: null,
            updatedAt: pushingAt,
        })

        const tokenOutcome = await this.deps.tokens.getToken({
            accountId: account.id,
            appId: account.app_id,
            appSecret,
        })
        if (!tokenOutcome.ok) {
            this.markPublishFailed(
                issue.id,
                issue.publish_id,
                issue.msg_data_id,
                tokenOutcome.errorCode,
                tokenOutcome.message,
            )
            throw new Error(tokenOutcome.message)
        }
        const token = tokenOutcome.token.accessToken

        this.report(issueId, onProgress, { kind: 'progress', issueId, stage: 'submit', message: '提交群发任务' })
        const submit = await submitWechatFreepublish(token, issue.media_id)
        if (!submit.ok) {
            this.markPublishFailed(issue.id, issue.publish_id, issue.msg_data_id, submit.errorCode, submit.message)
            throw new Error(submit.message)
        }

        this.report(issueId, onProgress, { kind: 'progress', issueId, stage: 'poll', message: '等待平台发布结果' })
        for (let attempt = 0; attempt < PUBLISH_POLL_ATTEMPTS; attempt += 1) {
            const state = await fetchWechatPublishState(token, submit.publishId)
            if (state.ok && state.state === 'published') {
                updateWechatIssuePublish(this.deps.db, {
                    id: issue.id,
                    status: 'published',
                    publishId: submit.publishId,
                    // 群发消息标识缺失时保留原值：重复发布不该把已有标识清掉
                    msgDataId: submit.msgDataId ?? issue.msg_data_id,
                    articleUrl: state.articleUrl ?? null,
                    publishedAt: new Date().toISOString(),
                    errorCode: null,
                    errorHint: null,
                    updatedAt: new Date().toISOString(),
                })
                const detail = this.deps.issues.detail(issue.id)
                return {
                    issue: detail.issue,
                    ...(state.articleUrl === undefined ? {} : { articleUrl: state.articleUrl }),
                }
            }
            if (state.ok && state.state === 'failed') {
                // 轮询判定失败：任务已受理，msg_data_id 以本次提交为准
                this.markPublishFailed(
                    issue.id,
                    submit.publishId,
                    submit.msgDataId ?? issue.msg_data_id,
                    0,
                    state.message,
                )
                throw new Error(state.message)
            }
            if (!state.ok) {
                // 查询失败不等于发布失败：任务已受理，保持 pushing 交给后台确认
                break
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, PUBLISH_POLL_INTERVAL_MS)
            })
        }

        const detail = this.deps.issues.detail(issue.id)
        return { issue: detail.issue }
    }

    /**
     * 回写群发失败：保留 publishId 与 msgDataId 便于到后台核对，
     * errorCode 为 0 表示没有平台错误码（如轮询判定失败但接口本身成功）。
     */
    private markPublishFailed(
        id: string,
        publishId: string | null,
        msgDataId: string | null,
        errorCode: number,
        hint: string,
    ): void {
        updateWechatIssuePublish(this.deps.db, {
            id,
            status: 'failed',
            publishId,
            msgDataId,
            articleUrl: null,
            publishedAt: null,
            errorCode: errorCode === 0 ? null : errorCode,
            errorHint: hint,
            updatedAt: new Date().toISOString(),
        })
    }
}
