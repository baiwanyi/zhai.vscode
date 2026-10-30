/**
 * 公众号账号服务：账号的列表、创建、更新、删除、鉴权测试与「当前账号」选定的唯一编排层。
 * 复用约定：落库走 db/accountRepository，密钥走 credentials，Token 走 tokenService；
 * 状态归一交给 client 的错误码表，本层只负责把结果写回账号并组装界面摘要。
 * 关键约束：创建即鉴权，鉴权失败不回滚账号（用户填错密钥时保留输入，改完可直接重测）；
 * 任一写操作后必须 invalidate 该账号的 Token 缓存，否则改动密钥后仍在用旧 Token；
 * AppSecret 只在此层短暂持有，摘要里只回传「是否已配置 + 尾号」，明文不进入返回值。
 */
import { randomUUID } from 'node:crypto'
import {
    readWechatAccountName,
    readWechatAccountType,
    WECHAT_ACCOUNT_STATUSES,
    type CreateWechatAccountRequest,
    type CreateWechatAccountResult,
    type RemoveWechatAccountResult,
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
    updateWechatAccountAuth,
    updateWechatAccountProfile,
    type WechatAccountRow,
} from './db/accountRepository'
import type { WechatTokenService } from './tokenService'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/** 当前账号在 globalState 中的键：与仪表盘页内路由各自表达选择，此处供工作流面板按账号取数 */
const SELECTED_ACCOUNT_KEY = 'zhai.wechat.selectedAccountId'

/** 未配置密钥时的状态提示 */
const MISSING_SECRET_HINT = '尚未配置 AppSecret，请先在账号设置里填写密钥。'

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
     * 创建账号并立即鉴权：AppID 重复即拒绝；鉴权失败保留账号并回写错误状态。
     * 关键约束：先写密钥再落库，落库失败时把刚写的密钥删掉，避免留下无主的密钥键。
     */
    public async create(request: CreateWechatAccountRequest): Promise<CreateWechatAccountResult> {
        const name = readWechatAccountName(request.name)
        if (name.length === 0) {
            throw new Error('账号名称不能为空')
        }
        const appId = request.appId.trim()
        if (findWechatAccountByAppId(this.deps.db, appId) !== null) {
            throw new Error(`该 AppID 已添加过：${appId}`)
        }

        const id = `acc-${randomUUID().replace(/-/g, '').slice(0, 10)}`
        const now = new Date().toISOString()
        await this.deps.secrets.write(id, request.appSecret.trim())
        try {
            insertWechatAccount(this.deps.db, {
                id,
                name,
                avatar: null,
                appId,
                accountType: readWechatAccountType(request.accountType),
                status: 'unauthenticated',
                createdAt: now,
            })
        } catch (cause) {
            await this.deps.secrets.remove(id)
            throw cause
        }

        await this.authenticate(id)
        const account = await this.readSummary(id)
        if (account === null) {
            throw new Error('账号创建后未能读取，请重试')
        }
        return { account }
    }

    /** 更新资料：密钥留空表示沿用旧值；改名与换密钥都不影响历史批次 */
    public async update(request: UpdateWechatAccountRequest): Promise<UpdateWechatAccountResult> {
        const existing = findWechatAccount(this.deps.db, request.id)
        if (existing === null) {
            throw new Error('账号不存在，可能已被删除')
        }
        const name = readWechatAccountName(request.name)
        if (name.length === 0) {
            throw new Error('账号名称不能为空')
        }
        const appId = request.appId.trim()
        const duplicated = findWechatAccountByAppId(this.deps.db, appId)
        if (duplicated !== null && duplicated.id !== existing.id) {
            throw new Error(`该 AppID 已被其它账号使用：${appId}`)
        }

        updateWechatAccountProfile(this.deps.db, {
            id: existing.id,
            name,
            appId,
            accountType: readWechatAccountType(request.accountType),
            updatedAt: new Date().toISOString(),
        })

        const nextSecret = request.appSecret?.trim() ?? ''
        const isCredentialChanged = nextSecret.length > 0
        if (isCredentialChanged) {
            await this.deps.secrets.write(existing.id, nextSecret)
            this.deps.tokens.invalidate(existing.id)
        }
        if (isCredentialChanged || appId !== existing.app_id) {
            await this.authenticate(existing.id)
        }

        const account = await this.readSummary(existing.id)
        if (account === null) {
            throw new Error('账号更新后未能读取，请重试')
        }
        return { account }
    }

    /** 删除账号：同步清理密钥与 Token 缓存；当前账号被删时一并清空选择 */
    public async remove(id: string): Promise<RemoveWechatAccountResult> {
        const existing = findWechatAccount(this.deps.db, id)
        if (existing === null) {
            return { removed: false }
        }
        deleteWechatAccount(this.deps.db, id)
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
