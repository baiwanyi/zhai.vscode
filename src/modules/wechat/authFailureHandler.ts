/**
 * 鉴权失败处理：把 Token 服务的失败回调落库，并转成面板可消费的广播载荷。
 * 复用约定：错误码口径与 accountService.authenticate 一致（45009 额度不足、48001 接口未授权记受限，
 * 其余记错误）；账号名定位走 db/accountRepository，事件类型取自 shared/types/wechat。
 * 关键约束：回调由每次取 Token 的路径触发，内部不得抛错——否则会顶掉调用方本应拿到的鉴权结果；
 * 广播出口由装配处注入，面板未订阅时自然丢弃。
 */
import type { WechatAccountAuthFailureEvent } from '@shared/types/wechat'
import { findWechatAccount, updateWechatAccountAuth } from './db/accountRepository'
import type { WechatAuthFailure } from './tokenService'
import type Database from 'better-sqlite3'

/** 鉴权失败广播出口：仪表盘与工作台两个面板共用同一份载荷 */
export type WechatAuthFailureListener = (event: WechatAccountAuthFailureEvent) => void

/** 造一个鉴权失败回调：先按口径更新账号状态，再把事件交给广播出口 */
export function createWechatAuthFailureHandler(deps: {
    db: Database.Database
    broadcast: WechatAuthFailureListener
}): (failure: WechatAuthFailure) => void {
    return (failure: WechatAuthFailure): void => {
        // 与 accountService.authenticate 同口径：额度与权限类记为受限，其余为错误
        const status = failure.errorCode === 45009 || failure.errorCode === 48001 ? 'limited' : 'error'
        updateWechatAccountAuth(deps.db, {
            id: failure.accountId,
            status,
            errorCode: failure.errorCode,
            statusHint: failure.message,
            updatedAt: new Date().toISOString(),
        })
        deps.broadcast({
            kind: 'authFailure',
            accountName: findWechatAccount(deps.db, failure.accountId)?.name ?? '公众号',
            ...failure,
        })
    }
}
