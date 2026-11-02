/**
 * 公众号账号服务：账号的列表、创建、更新、删除、鉴权测试与「当前账号」选定的唯一编排层。
 * 复用约定：落库走 db/accountRepository，密钥走 credentials，Token 走 tokenService；
 * 状态归一交给 client 的错误码表，本层只负责把结果写回账号并组装界面摘要。
 * 关键约束：创建即鉴权，鉴权失败不回滚账号（用户填错密钥时保留输入，改完可直接重测）；
 * 任一写操作后必须 invalidate 该账号的 Token 缓存，否则改动密钥后仍在用旧 Token；
 * AppSecret 只在此层短暂持有，摘要里只回传「是否已配置 + 尾号」，明文不进入返回值。
 */
import { randomUUID } from 'node:crypto'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import {
    readWechatAccountName,
    readWechatAccountType,
    readWechatArticleAuthor,
    WECHAT_ACCOUNT_STATUSES,
    WECHAT_MODULE_DIR,
    type CreateWechatAccountRequest,
    type CreateWechatAccountResult,
    type RemoveWechatAccountResult,
    type SaveWechatAccountCredentialsRequest,
    type SaveWechatAccountCredentialsResult,
    type SelectWechatAccountResult,
    type UpdateWechatAccountRequest,
    type UpdateWechatAccountResult,
    type WechatAccountStatus,
    type WechatAccountSummary,
    type WechatAccountTestResult,
    type WechatAccountsResult,
} from '@shared/types/wechat'
import { NETWORK_ERROR_CODE } from './client'
import { formatWechatSecretHint, type WechatSecretStore } from './credentials'
import {
    deleteWechatAccount,
    findWechatAccount,
    findWechatAccountByAppId,
    insertWechatAccount,
    listWechatAccounts,
    readWechatIssueMetrics,
    updateWechatAccountAppId,
    updateWechatAccountAuth,
    updateWechatAccountProfile,
    type WechatAccountRow,
} from './db/accountRepository'
import { removeWechatIssueDirectory } from './issueDocument'
import type { WechatTokenService } from './tokenService'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/** 当前账号在 globalState 中的键：与仪表盘页内路由各自表达选择，此处供工作流面板按账号取数 */
const SELECTED_ACCOUNT_KEY = 'zhai.wechat.selectedAccountId'

/** 未配置密钥时的状态提示 */
const MISSING_SECRET_HINT = '尚未配置凭据，请在「密钥设置」里填写 AppID 与 AppSecret。'

/** 服务依赖：库、密钥存取、Token 缓存与当前账号的持久化位置 */
export interface WechatAccountServiceDeps {
    db: Database.Database
    secrets: WechatSecretStore
    tokens: WechatTokenService
    state: vscode.Memento
}

/** 收窄库内状态：脏数据一律按未鉴权处理，避免前端拿到未知状态 */
function readStatus(value: string): WechatAccountStatus {
    return WECHAT_ACCOUNT_STATUSES.find((status) => status === value) ?? 'unauthenticated'
}

/** 错误码 → 账号状态：仅区分额度与权限受限、一般错误，成功态由调用方给出 */
function readStatusFromCode(errorCode: number): WechatAccountStatus {
    return errorCode === 45009 || errorCode === 48001 ? 'limited' : 'error'
}

export class WechatAccountService {
    public constructor(private readonly deps: WechatAccountServiceDeps) {}

    /** 列出全部账号：批次数与最近推送时间来自 wechat_issues 聚合，当前账号一并回传供列表打标 */
    public async list(): Promise<WechatAccountsResult> {
        const rows = listWechatAccounts(this.deps.db)
        const metrics = readWechatIssueMetrics(this.deps.db)
        const accounts = await Promise.all(
            rows.map((row) => {
                const metric = metrics.get(row.id)
                return this.toSummary(row, metric?.issueCount ?? 0, metric?.lastPublishAt ?? null)
            }),
        )
        return { accounts, selectedId: this.selectedId() }
    }

    /**
     * 创建账号：只写账号设置，凭据留空等用户在「密钥设置」里补。
     * 关键约束：AppID 未配置前落空串，状态置为未鉴权并给出「去填密钥」的提示；
     * 批次目录以 AppID 命名，因此未配置凭据的账号不能建批次（由批次服务校验）。
     */
    public async create(request: CreateWechatAccountRequest): Promise<CreateWechatAccountResult> {
        const name = readWechatAccountName(request.name)
        if (name.length === 0) {
            throw new Error('账号名称不能为空')
        }
        const id = `acc-${randomUUID().replace(/-/g, '').slice(0, 10)}`
        const now = new Date().toISOString()
        insertWechatAccount(this.deps.db, {
            id,
            name,
            avatar: null,
            appId: '',
            accountType: readWechatAccountType(request.accountType),
            status: 'unauthenticated',
            defaultAuthor: readWechatArticleAuthor(request.defaultAuthor) || null,
            createdAt: now,
        })

        // 没有密钥时 authenticate 只写「未配置」提示，不会发起网络请求
        await this.authenticate(id)
        const account = await this.readSummary(id)
        if (account === null) {
            throw new Error('账号创建后未能读取，请重试')
        }
        return { account }
    }

    /** 更新账号设置：名称、类型与默认作者，不触碰凭据与鉴权状态 */
    public async update(request: UpdateWechatAccountRequest): Promise<UpdateWechatAccountResult> {
        const existing = findWechatAccount(this.deps.db, request.id)
        if (existing === null) {
            throw new Error('账号不存在，可能已被删除')
        }
        const name = readWechatAccountName(request.name)
        if (name.length === 0) {
            throw new Error('账号名称不能为空')
        }
        updateWechatAccountProfile(this.deps.db, {
            id: existing.id,
            name,
            accountType: readWechatAccountType(request.accountType),
            defaultAuthor: readWechatArticleAuthor(request.defaultAuthor) || null,
            updatedAt: new Date().toISOString(),
        })

        const account = await this.readSummary(existing.id)
        if (account === null) {
            throw new Error('账号更新后未能读取，请重试')
        }
        return { account }
    }

    /**
     * 保存凭据并立即鉴权：AppID 必填，AppSecret 留空表示沿用已存密钥。
     * 关键约束：AppID 与其他账号重复即拒绝；写入后先失效 Token 再鉴权，
     * 否则续用旧 Token 会让「改完密钥仍连不上」看起来像没生效。
     */
    public async saveCredentials(
        request: SaveWechatAccountCredentialsRequest,
    ): Promise<SaveWechatAccountCredentialsResult> {
        const existing = findWechatAccount(this.deps.db, request.id)
        if (existing === null) {
            throw new Error('账号不存在，可能已被删除')
        }
        const appId = request.appId.trim()
        const duplicated = findWechatAccountByAppId(this.deps.db, appId)
        if (duplicated !== null && duplicated.id !== existing.id) {
            throw new Error(`该 AppID 已被其它账号使用：${appId}`)
        }
        const nextSecret = request.appSecret?.trim() ?? ''
        if (nextSecret.length > 0) {
            await this.deps.secrets.write(existing.id, nextSecret)
        } else if (existing.app_id.length === 0) {
            // 首次配置：没有 AppSecret 就无从鉴权，直接拒绝而不是留下半个凭据
            throw new Error('首次配置需要同时填写 AppSecret')
        }

        if (appId !== existing.app_id) {
            updateWechatAccountAppId(this.deps.db, existing.id, appId)
        }
        this.deps.tokens.invalidate(existing.id)
        await this.authenticate(existing.id)

        const account = await this.readSummary(existing.id)
        if (account === null) {
            throw new Error('凭据保存后未能读取，请重试')
        }
        return { account }
    }

    /**
     * 删除账号：同步清理密钥、Token 缓存与该账号的批次目录；当前账号被删时一并清空选择。
     * 关键约束：批次稿目录是本模块生成的，账号没了就没有再保留的理由；删不掉只记日志，不阻断账号删除。
     */
    public async remove(id: string): Promise<RemoveWechatAccountResult> {
        const existing = findWechatAccount(this.deps.db, id)
        if (existing === null) {
            return { removed: false }
        }
        deleteWechatAccount(this.deps.db, id)
        await this.removeAccountDirectory(existing.app_id)
        await this.deps.secrets.remove(id)
        this.deps.tokens.invalidate(id)
        if (this.selectedId() === id) {
            await this.select(null)
        }
        return { removed: true }
    }

    /** 重新鉴权：供列表页的「刷新状态」与创建后的首次校验共用 */
    public async test(id: string): Promise<WechatAccountTestResult> {
        const existing = findWechatAccount(this.deps.db, id)
        if (existing === null) {
            throw new Error('账号不存在，可能已被删除')
        }
        return this.authenticate(id)
    }

    /** 读取当前账号 id：工作流面板据此决定六分区的作用域 */
    public selectedId(): string | null {
        const value = this.deps.state.get<string>(SELECTED_ACCOUNT_KEY)
        if (typeof value !== 'string' || findWechatAccount(this.deps.db, value) === null) {
            return null
        }
        return value
    }

    /** 写入当前账号：id 为 null 表示清除；不存在的 id 直接拒绝 */
    public async select(id: string | null): Promise<SelectWechatAccountResult> {
        if (id === null) {
            await this.deps.state.update(SELECTED_ACCOUNT_KEY, undefined)
            return { selectedId: null }
        }
        if (findWechatAccount(this.deps.db, id) === null) {
            throw new Error('账号不存在，无法切换')
        }
        await this.deps.state.update(SELECTED_ACCOUNT_KEY, id)
        return { selectedId: id }
    }

    /**
     * 鉴权并回写状态：无密钥直接置为未配置，网络失败与平台错误码分别归一。
     * 关键约束：errorCode 为 0 表示没拿到平台响应，此时不写错误码，只落提示。
     */
    private async authenticate(id: string): Promise<WechatAccountTestResult> {
        const row = findWechatAccount(this.deps.db, id)
        if (row === null) {
            throw new Error('账号不存在，可能已被删除')
        }
        const appSecret = await this.deps.secrets.read(id)
        const now = new Date().toISOString()
        if (appSecret === undefined || appSecret.length === 0) {
            updateWechatAccountAuth(this.deps.db, {
                id,
                status: 'unauthenticated',
                errorCode: null,
                statusHint: MISSING_SECRET_HINT,
                updatedAt: now,
            })
            return { status: 'unauthenticated', hint: MISSING_SECRET_HINT }
        }

        this.deps.tokens.invalidate(id)
        const outcome = await this.deps.tokens.getToken({ accountId: id, appId: row.app_id, appSecret })
        if (outcome.ok) {
            updateWechatAccountAuth(this.deps.db, {
                id,
                status: 'connected',
                errorCode: null,
                statusHint: null,
                updatedAt: now,
            })
            return { status: 'connected' }
        }

        const isNetwork = outcome.errorCode === NETWORK_ERROR_CODE
        const status = isNetwork ? 'error' : readStatusFromCode(outcome.errorCode)
        updateWechatAccountAuth(this.deps.db, {
            id,
            status,
            errorCode: isNetwork ? null : outcome.errorCode,
            statusHint: outcome.message,
            updatedAt: now,
        })
        return { status, ...(isNetwork ? {} : { errorCode: outcome.errorCode }), hint: outcome.message }
    }

    /** 清掉该账号的批次目录：存储根未配置或目录被占用时只记日志，不阻断账号删除 */
    private async removeAccountDirectory(appId: string): Promise<void> {
        try {
            await removeWechatIssueDirectory(resolveStorageRoot(), `${WECHAT_MODULE_DIR}/${appId}`)
        } catch (cause) {
            logger.warn(`账号批次目录清理失败：${appId}（${cause instanceof Error ? cause.message : String(cause)}）`)
        }
    }

    /** 读取单个账号摘要：写操作后回传最新快照，前端不必再拉全量 */
    private async readSummary(id: string): Promise<WechatAccountSummary | null> {
        const row = findWechatAccount(this.deps.db, id)
        if (row === null) {
            return null
        }
        const metric = readWechatIssueMetrics(this.deps.db).get(id)
        return this.toSummary(row, metric?.issueCount ?? 0, metric?.lastPublishAt ?? null)
    }

    /** 行 → 界面摘要：密钥只读尾号，未配置时不返回 secretHint */
    private async toSummary(
        row: WechatAccountRow,
        issueCount: number,
        lastPublishAt: string | null,
    ): Promise<WechatAccountSummary> {
        const appSecret = await this.deps.secrets.read(row.id)
        const hasSecret = appSecret !== undefined && appSecret.length > 0
        return {
            id: row.id,
            name: row.name,
            ...(row.avatar === null ? {} : { avatar: row.avatar }),
            appId: row.app_id,
            accountType: readWechatAccountType(row.account_type),
            ...(row.default_author === null || row.default_author.length === 0
                ? {}
                : { defaultAuthor: row.default_author }),
            verified: row.verified === 1,
            status: readStatus(row.status),
            ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
            ...(row.status_hint === null ? {} : { statusHint: row.status_hint }),
            fanCount: row.fan_count,
            issueCount,
            lastPublishAt,
            hasSecret,
            ...(hasSecret ? { secretHint: formatWechatSecretHint(appSecret) } : {}),
            updatedAt: row.updated_at,
        }
    }
}
