/**
 * 账号 Token 取用：把「账号 → AppSecret → access_token」这段重复流程收在一处。
 * 复用约定：素材、草稿、群发与三个运营服务都走本函数，Token 由 tokenService 统一缓存与并发合并，
 * 密钥只从 SecretStorage 读取，任何服务都不把密钥写进返回值或错误消息。
 * 关键约束：三条失败路径（账号不存在、密钥缺失、换取失败）都抛成带可执行提示的错误，
 * 由协议层统一转成 toast，服务内部不再各自包装。
 */
import { findWechatAccount } from './db/accountRepository'
import type { WechatSecretStore } from './credentials'
import type { WechatAccountRow } from './db/accountRepository'
import type { WechatTokenService } from './tokenService'
import type Database from 'better-sqlite3'

/** 取 Token 所需的三个依赖：账号表、密钥存储与 Token 缓存 */
export interface WechatTokenAccessDeps {
    db: Database.Database
    secrets: WechatSecretStore
    tokens: WechatTokenService
}

/** 取到的账号与 Token：账号行用于读取 AppID、类型等展示字段 */
export interface WechatTokenAccess {
    account: WechatAccountRow
    accessToken: string
}

/** 取当前账号的 access_token，失败即抛错 */
export async function requireWechatToken(deps: WechatTokenAccessDeps, accountId: string): Promise<WechatTokenAccess> {
    const account = findWechatAccount(deps.db, accountId)
    if (account === null) {
        throw new Error('公众号账号不存在，可能已被删除')
    }
    const appSecret = await deps.secrets.read(accountId)
    if (appSecret === undefined || appSecret.length === 0) {
        throw new Error('公众号密钥缺失：请在账号设置里重新填写 AppSecret')
    }
    const outcome = await deps.tokens.getToken({ accountId, appId: account.app_id, appSecret })
    if (!outcome.ok) {
        throw new Error(outcome.message)
    }
    return { account, accessToken: outcome.token.accessToken }
}
