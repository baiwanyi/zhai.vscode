/**
 * 公众号契约：账号摘要、创建/更新/删除/测试连接与当前账号选定的请求结构，以及账号类型与状态的唯一口径。
 * 使用方：仪表盘 Webview 的公众号列表页与宿主侧 DashboardViewProvider、modules/wechat 服务。
 * 复用约定：id 取本地生成的短 id（小写字母数字与连字符），与页内路由 #/wechat/{accountId} 同源；
 * 账号名称、类型与 AppID 落 wechat.db，AppSecret 只回传「是否已配置 + 尾号」，明文仅存 SecretStorage。
 * 关键约束：前端传入的字段一律不可信，宿主须经本文件的收窄函数校验后才可写库或发起网络请求；
 * 账号状态由宿主按接口错误码归一（40164 等），前端只负责展示，不自行推断。
 */

/** 账号类型：订阅号与服务号的能力差异见 wechat.md 第 8 节 */
export const WECHAT_ACCOUNT_TYPES = ['subscription', 'service'] as const

/** 账号类型取值 */
export type WechatAccountType = (typeof WECHAT_ACCOUNT_TYPES)[number]

/** 未指定时的默认账号类型 */
export const DEFAULT_WECHAT_ACCOUNT_TYPE: WechatAccountType = 'subscription'

/** 账号类型展示名：列表徽标与表单选项共用一处口径 */
export const WECHAT_ACCOUNT_TYPE_LABELS: Readonly<Record<WechatAccountType, string>> = {
    subscription: '订阅号',
    service: '服务号',
}

/** 账号连接状态：由宿主按鉴权结果归一，前端据此决定色点与错误摘要 */
export const WECHAT_ACCOUNT_STATUSES = ['connected', 'unauthenticated', 'error', 'limited'] as const

/** 账号连接状态取值 */
export type WechatAccountStatus = (typeof WECHAT_ACCOUNT_STATUSES)[number]

/** 账号名称长度上限：与公众号后台的账号名长度无关，仅为列表展示与输入约束 */
export const WECHAT_ACCOUNT_NAME_MAX = 40

/** AppID 形态：微博与公众号均由平台签发，公众号为 wx 开头的字母数字串；此处只做形态收窄，不做前缀强校验 */
const APP_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/

/** AppSecret 形态：平台签发为字母数字串，长度随账号类型略有差异，按区间收窄 */
const APP_SECRET_PATTERN = /^[A-Za-z0-9]{16,64}$/

/** 本地账号 id 形态：与页内路由的 hash 段同源，禁止出现路径分隔符 */
const ACCOUNT_ID_PATTERN = /^[a-z0-9-]{1,64}$/

/** 账号摘要：宿主按 wechat.db 聚合，列表页直接渲染 */
export interface WechatAccountSummary {
    /** 本地账号 id，同时用作页内路由段 */
    id: string
    /** 账号名称：微信无公开接口可拉取，由用户填写 */
    name: string
    /** 头像地址：缺省时前端用名称首字占位 */
    avatar?: string
    /** 平台 AppID（非敏感，可在列表中展示） */
    appId: string
    /** 账号类型 */
    accountType: WechatAccountType
    /** 是否已认证：决定发布、数据统计等能力是否可用 */
    verified: boolean
    /** 最近一次鉴权结果归一后的状态 */
    status: WechatAccountStatus
    /** 最近一次鉴权失败的微信错误码（如 40164 IP 不在白名单） */
    lastErrorCode?: number
    /** 与错误码配套的可执行提示，直接取自宿主归一结果 */
    statusHint?: string
    /** 粉丝数：由数据统计接口回填，未取到时为 0 */
    fanCount: number
    /** 推送批次数：来自 wechat_issues 的聚合 */
    issueCount: number
    /** 最近一次推送时间（ISO 8601），未推送过为 null */
    lastPublishAt: string | null
    /** 是否已配置 AppSecret：明文不出宿主，前端据此判断能否发起鉴权 */
    hasSecret: boolean
    /** 密钥尾号提示，形如 ****3f2a；未配置时缺省 */
    secretHint?: string
    /** 最近更新时间（ISO 8601） */
    updatedAt: string
}

/** wechat/accounts 响应：账号快照与当前账号一次取回，列表的「当前」徽标据此渲染 */
export interface WechatAccountsResult {
    accounts: WechatAccountSummary[]
    /** 当前账号 id：未选择或所选账号已被删除时为 null */
    selectedId: string | null
}

/** wechat/account/create 请求 */
export interface CreateWechatAccountRequest {
    /** 账号名称，写入前由宿主折叠空白并截断 */
    name: string
    /** 平台 AppID */
    appId: string
    /** 平台 AppSecret：仅经协议传入一次，落 SecretStorage 后不再回传 */
    appSecret: string
    /** 账号类型，非法值回落订阅号 */
    accountType?: string
}

/** wechat/account/create 响应：返回落库后的摘要，前端据此跳到该账号 */
export interface CreateWechatAccountResult {
    account: WechatAccountSummary
}

/** wechat/account/update 请求 */
export interface UpdateWechatAccountRequest {
    /** 目标账号 id，须已在库中存在 */
    id: string
    /** 账号名称 */
    name: string
    /** 平台 AppID */
    appId: string
    /** 新密钥：留空或缺省表示沿用已存密钥 */
    appSecret?: string
    /** 账号类型，非法值回落订阅号 */
    accountType?: string
}

/** wechat/account/update 响应 */
export interface UpdateWechatAccountResult {
    account: WechatAccountSummary
}

/** wechat/account/remove 请求 */
export interface RemoveWechatAccountRequest {
    /** 目标账号 id */
    id: string
}

/** wechat/account/remove 响应 */
export interface RemoveWechatAccountResult {
    removed: boolean
}

/** wechat/account/test 请求：重新鉴权并回写状态 */
export interface TestWechatAccountRequest {
    /** 目标账号 id */
    id: string
}

/** wechat/account/test 响应：status 只可能是 connected 与 error（未配置密钥时为 unauthenticated） */
export interface WechatAccountTestResult {
    /** 归一后的连接状态 */
    status: WechatAccountStatus
    /** 微信错误码，成功时缺省 */
    errorCode?: number
    /** 可执行提示，成功时缺省 */
    hint?: string
}

/** wechat/account/select 请求：写入当前账号，供工作流面板按账号取数 */
export interface SelectWechatAccountRequest {
    /** 目标账号 id，null 表示清除选择 */
    id: string | null
}

/** wechat/account/select 响应 */
export interface SelectWechatAccountResult {
    selectedId: string | null
}

/** 收窄账号类型：非法值回落默认类型，避免前端传入任意字符串落库 */
export function readWechatAccountType(value: unknown): WechatAccountType {
    return value === 'service' ? 'service' : DEFAULT_WECHAT_ACCOUNT_TYPE
}

/**
 * 规整账号名称：折叠连续空白并截断到上限。
 * 关键约束：空名称返回空串，由调用方判定为非法，不在此处兜底成默认名。
 */
export function readWechatAccountName(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, WECHAT_ACCOUNT_NAME_MAX)
}

/** 收窄本地账号 id：形态不符直接拒绝，避免任意字符串流入库查询与路由 */
export function isWechatAccountId(value: unknown): value is string {
    return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value)
}

/** 收窄 AppID：形态不符即拒绝，不在前端做前缀判断 */
export function isWechatAppId(value: unknown): value is string {
    return typeof value === 'string' && APP_ID_PATTERN.test(value.trim())
}

/** 收窄 AppSecret：形态不符即拒绝；密码本身不做 trim 之外的改造 */
export function isWechatAppSecret(value: unknown): value is string {
    return typeof value === 'string' && APP_SECRET_PATTERN.test(value.trim())
}

/** 判断是否为创建账号请求：名称、AppID 与密钥三项必填 */
export function isCreateWechatAccountRequest(payload: unknown): payload is CreateWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { name?: unknown; appId?: unknown; appSecret?: unknown }
    return (
        typeof candidate.name === 'string' &&
        readWechatAccountName(candidate.name).length > 0 &&
        isWechatAppId(candidate.appId) &&
        isWechatAppSecret(candidate.appSecret)
    )
}

/** 判断是否为更新账号请求：密钥可缺省表示沿用旧值 */
export function isUpdateWechatAccountRequest(payload: unknown): payload is UpdateWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const candidate = payload as { id?: unknown; name?: unknown; appId?: unknown; appSecret?: unknown }
    if (!isWechatAccountId(candidate.id)) {
        return false
    }
    if (typeof candidate.name !== 'string' || readWechatAccountName(candidate.name).length === 0) {
        return false
    }
    if (!isWechatAppId(candidate.appId)) {
        return false
    }
    return candidate.appSecret === undefined || isWechatAppSecret(candidate.appSecret)
}

/** 判断是否为删除账号请求 */
export function isRemoveWechatAccountRequest(payload: unknown): payload is RemoveWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { id?: unknown }).id)
}

/** 判断是否为测试连接请求 */
export function isTestWechatAccountRequest(payload: unknown): payload is TestWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    return isWechatAccountId((payload as { id?: unknown }).id)
}

/** 判断是否为选择当前账号请求：id 为 null 表示清除 */
export function isSelectWechatAccountRequest(payload: unknown): payload is SelectWechatAccountRequest {
    if (typeof payload !== 'object' || payload === null) {
        return false
    }
    const { id } = payload as { id?: unknown }
    return id === null || isWechatAccountId(id)
}
