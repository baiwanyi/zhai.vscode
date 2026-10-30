/**
 * AccessToken 管理：按账号分桶缓存，并对进行中的刷新请求做 singleflight 合并。
 * 复用约定：凭证换取统一走 client 的 requestWechatToken，本层只负责缓存与并发；调用方传入账号凭据，
 * 不感知缓存实现，鉴权失败的原因码原样返回给账号服务落库。
 * 关键约束：同一账号并发调用只触发一次网络请求——各自刷新的 Token 会互相失效，是公众号对接的经典坑；
 * 提前 5 分钟视为过期，避免请求途中恰好越过有效期；账号被删除或密钥被改写时必须 invalidate，
 * 否则后续请求会继续复用旧账号的 Token。
 */
import { requestWechatToken } from './client'
import type { WechatAuthOutcome } from './client'

/** 提前刷新窗口：剩余有效期不足该秒数即视为过期 */
const EARLY_REFRESH_SECONDS = 300

/** 鉴权请求：账号 id 用于分桶，凭据由账号服务读出后传入 */
export interface WechatTokenRequest {
    accountId: string
    appId: string
    appSecret: string
}

/** 缓存项：token 与绝对过期时间（毫秒） */
interface TokenCacheEntry {
    token: string
    expiresAt: number
}

export class WechatTokenService {
    /** 账号 id → 缓存凭证 */
    private readonly cache = new Map<string, TokenCacheEntry>()

    /** 账号 id → 进行中的刷新请求，用于合并并发调用 */
    private readonly inflight = new Map<string, Promise<WechatAuthOutcome>>()

    /**
     * 取该账号可用的 access_token：命中缓存直接返回，未命中则发起（或复用）一次刷新。
     * 失败结果不缓存，下一次调用会重新尝试，避免一次网络抖动把账号长期钉在失败态。
     */
    public async getToken(request: WechatTokenRequest): Promise<WechatAuthOutcome> {
        const cached = this.cache.get(request.accountId)
        if (cached !== undefined && cached.expiresAt > Date.now()) {
            return {
                ok: true,
                token: { accessToken: cached.token, expiresIn: Math.floor((cached.expiresAt - Date.now()) / 1000) },
            }
        }

        const running = this.inflight.get(request.accountId)
        if (running !== undefined) {
            return running
        }

        const task = this.refresh(request)
        this.inflight.set(request.accountId, task)
        try {
            return await task
        } finally {
            this.inflight.delete(request.accountId)
        }
    }

    /** 丢弃该账号的缓存：密钥变更、账号删除或收到 Token 失效错误码时调用 */
    public invalidate(accountId: string): void {
        this.cache.delete(accountId)
        this.inflight.delete(accountId)
    }

    /** 清空全部缓存：扩展停用或切换存储根时调用 */
    public clear(): void {
        this.cache.clear()
        this.inflight.clear()
    }

    /** 实际发起刷新：成功后写入缓存（扣除提前刷新窗口） */
    private async refresh(request: WechatTokenRequest): Promise<WechatAuthOutcome> {
        const outcome = await requestWechatToken(request.appId, request.appSecret)
        if (!outcome.ok) {
            return outcome
        }
        const lifetimeSeconds = Math.max(outcome.token.expiresIn - EARLY_REFRESH_SECONDS, 0)
        this.cache.set(request.accountId, {
            token: outcome.token.accessToken,
            expiresAt: Date.now() + lifetimeSeconds * 1000,
        })
        return outcome
    }
}
