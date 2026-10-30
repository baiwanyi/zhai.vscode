/**
 * 公众号凭证存取：按账号分键把 AppSecret 写入 VSCode SecretStorage（系统级加密）。
 * 复用约定：common/secrets 管理的是全局单值密钥（如 AI 通道），本模块的密钥随账号数量增长，
 * 故按 `zhai.wechat.appSecret.{accountId}` 分键保存，存取接口与 SecretStorageLike 同形，便于单测替换。
 * 关键约束：密钥只写不读回前端，列表与详情只回传是否已配置与尾号；删除账号须同步删键，
 * 否则重新添加同 id 账号会沿用旧密钥；任何日志与错误提示都不得拼接明文。
 */
import type * as vscode from 'vscode'

/** SecretStorage 中密钥键的统一前缀 */
const SECRET_KEY_PREFIX = 'zhai.wechat.appSecret.'

/** 尾号展示保留的字符数 */
const HINT_TAIL_LENGTH = 4

/**
 * 账号密钥存取：三个动作都是幂等的，删除不存在的键不算失败。
 * 返回 PromiseLike 而非 Promise：VSCode 的 SecretStorage 返回 Thenable，await 即可，无需再包一层。
 */
export interface WechatSecretStore {
    read(accountId: string): PromiseLike<string | undefined>
    write(accountId: string, appSecret: string): PromiseLike<void>
    remove(accountId: string): PromiseLike<void>
}

/** 由扩展上下文的 SecretStorage 构造账号密钥存取器 */
export function createWechatSecretStore(storage: vscode.SecretStorage): WechatSecretStore {
    return {
        read: (accountId: string): PromiseLike<string | undefined> => storage.get(`${SECRET_KEY_PREFIX}${accountId}`),
        write: (accountId: string, appSecret: string): PromiseLike<void> =>
            storage.store(`${SECRET_KEY_PREFIX}${accountId}`, appSecret),
        remove: (accountId: string): PromiseLike<void> => storage.delete(`${SECRET_KEY_PREFIX}${accountId}`),
    }
}

/**
 * 密钥尾号提示：形如 ****3f2a，仅用于让用户确认「填的是哪一条」，不足以还原明文。
 * 密钥过短时整体打码，避免尾号过长反而泄露大半内容。
 */
export function formatWechatSecretHint(appSecret: string): string {
    if (appSecret.length <= HINT_TAIL_LENGTH * 2) {
        return '****'
    }
    return `****${appSecret.slice(-HINT_TAIL_LENGTH)}`
}
