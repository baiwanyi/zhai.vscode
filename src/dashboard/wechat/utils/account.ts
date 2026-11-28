/**
 * 公众号账号展示口径：状态文案与色点、账号类型、三段元信息与鉴权失败提示。
 * 复用约定：账号类型文案取 shared/types/wechat，相对时间取 shared/utils/format，
 * 粉丝数字取 dashboard/utils 的 formatWordCount，均不在此重复定义。
 * 关键约束：状态色点只用主题令牌；鉴权失败时由调用方展示 statusHint，本模块只负责正常态三段口径。
 */
import type { WechatAccountStatus, WechatAccountSummary } from '@shared/types/wechat'
import { WECHAT_ACCOUNT_TYPE_LABELS } from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'
import { formatWordCount } from '../../utils'

/** 状态短文案：用于徽标与提示，鉴权失败的具体原因由宿主的 statusHint 承载 */
export const WECHAT_STATUS_LABELS: Readonly<Record<WechatAccountStatus, string>> = {
    connected: '正常',
    unauthenticated: '未配置密钥',
    error: '鉴权失败',
    limited: '额度受限',
}

/** 状态色点：只用主题令牌，随明暗主题自动切换 */
export const WECHAT_STATUS_DOT_CLASS: Readonly<Record<WechatAccountStatus, string>> = {
    connected: 'bg-primary',
    unauthenticated: 'bg-muted-foreground opacity-50',
    error: 'bg-destructive',
    limited: 'bg-muted-foreground',
}

/** 账号类型徽标文案 */
export function formatAccountType(account: WechatAccountSummary): string {
    return WECHAT_ACCOUNT_TYPE_LABELS[account.accountType]
}

/**
 * 账号元信息行：批次数 · 粉丝数 · 最近推送。
 * 关键约束：鉴权失败时改由调用方展示 statusHint，本函数只负责正常态的三段口径。
 */
export function formatAccountMeta(account: WechatAccountSummary): string {
    const publishText =
        account.lastPublishAt === null ? '尚未推送' : `最近推送 ${formatRelativeTime(account.lastPublishAt)}`
    return [`${String(account.issueCount)} 篇`, `${formatWordCount(account.fanCount)} 粉丝`, publishText]
        .filter((part) => part.length > 0)
        .join(' · ')
}

/** 异常态摘要：优先用宿主落库的可执行提示，缺省时回落到状态文案 */
export function formatAccountStatusHint(account: WechatAccountSummary): string {
    if (account.status === 'connected') {
        return formatAccountMeta(account)
    }
    if (account.statusHint !== undefined && account.statusHint.length > 0) {
        return account.statusHint
    }
    return WECHAT_STATUS_LABELS[account.status]
}

/** 账号名首字：头像缺省时的占位字符，中英文都取第一个字符 */
export function readAccountInitial(name: string): string {
    const [first] = Array.from(name)
    return first ?? '公'
}
