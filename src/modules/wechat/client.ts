/**
 * 公众号接口客户端：换取 access_token，并把微信错误码归一为账号状态与可执行提示。
 * 复用约定：统一走 Node 内置 fetch，不引入第三方 SDK；超时用 AbortSignal.timeout，
 * 错误码文案集中在本文件的错误表，服务层与界面不再各自拼接提示。
 * 关键约束：只做网络与报文收窄，不写库、不缓存（Token 缓存与并发去重见 tokenService）；
 * 平台返回的 errmsg 只作辅助信息，面向用户的提示以本表的 hint 为准，避免出现英文原文；
 * 密钥不得进入日志或错误消息。
 */
import type { WechatAccountStatus } from '@shared/types/wechat'

/** Token 接口地址：公众号全局唯一入口 */
const TOKEN_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/token'

/** 单次鉴权超时：公网抖动时宁可失败重试，也不让面板长时间转圈 */
const REQUEST_TIMEOUT_MS = 10_000

/** 换取成功的凭证：expiresIn 为平台给出的有效期（秒） */
export interface WechatTokenGrant {
    accessToken: string
    expiresIn: number
}

/** 鉴权结果：失败时携带已归一的错误码与消息，由服务层落库为账号状态 */
export type WechatAuthOutcome =
    { ok: true; token: WechatTokenGrant } | { ok: false; errorCode: number; message: string }

/** 错误码归一结果：状态决定列表色点，提示给出下一步动作 */
export interface WechatErrorHint {
    status: WechatAccountStatus
    hint: string
}

/** 微信错误码 → 状态与提示：键为字符串，便于容纳负数错误码 */
const ERROR_HINTS: Readonly<Record<string, WechatErrorHint>> = {
    '40164': {
        status: 'error',
        hint: '调用方 IP 不在公众号后台的 IP 白名单内：请把当前出口 IP 加入「设置与开发 → 基本配置 → IP 白名单」。',
    },
    '40001': { status: 'error', hint: 'AppSecret 不正确或已被重置，请重新填写密钥。' },
    '40013': { status: 'error', hint: 'AppID 无效，请核对公众号后台的开发者 ID。' },
    '40125': { status: 'error', hint: 'AppSecret 无效，请重新填写密钥。' },
    '45009': { status: 'limited', hint: '接口调用超过当日额度，请稍后再试。' },
    '48001': { status: 'limited', hint: '该账号未获得此接口权限（通常需要认证主体）。' },
    '-1': { status: 'error', hint: '微信服务器繁忙，请稍后重试。' },
}

/** 未知错误码的兜底提示 */
const FALLBACK_HINT: WechatErrorHint = { status: 'error', hint: '鉴权失败，请检查 AppID 与 AppSecret 后重试。' }

/** 网络层失败的错误码：0 表示没有拿到平台响应，与服务端错误码区分 */
export const NETWORK_ERROR_CODE = 0

/**
 * 归一微信错误码：未登记的错误码回落到通用提示，不把 errmsg 原文透给用户。
 * 关键约束：返回的状态只能是 error 或 limited，成功态由调用方按 ok 分支给出。
 */
export function describeWechatError(errorCode: number): WechatErrorHint {
    return ERROR_HINTS[String(errorCode)] ?? FALLBACK_HINT
}

/** 收窄错误文本：宿主侧不依赖前端 utils（其顶层引 sonner），此处单独归一 */
function errorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 收窄 Token 报文：成功与失败共用同一响应形状，逐字段判定后才使用 */
type TokenPayload = { kind: 'grant'; accessToken: string; expiresIn: number } | { kind: 'error'; errorCode: number }

/** 解析平台响应：字段缺失或缺类型时按未知错误处理 */
function parseTokenPayload(raw: unknown): TokenPayload {
    if (typeof raw !== 'object' || raw === null) {
        return { kind: 'error', errorCode: -1 }
    }
    const candidate = raw as { access_token?: unknown; expires_in?: unknown; errcode?: unknown }
    if (typeof candidate.access_token === 'string' && candidate.access_token.length > 0) {
        const expiresIn = typeof candidate.expires_in === 'number' ? candidate.expires_in : 7200
        return { kind: 'grant', accessToken: candidate.access_token, expiresIn }
    }
    const errorCode = typeof candidate.errcode === 'number' ? candidate.errcode : -1
    return { kind: 'error', errorCode }
}

/**
 * 用 AppID 与 AppSecret 换取 access_token。
 * 关键约束：HTTP 状态非 2xx 一律按网络错误处理；密钥仅作为查询参数出现在本次请求中，不落日志。
 */
export async function requestWechatToken(appId: string, appSecret: string): Promise<WechatAuthOutcome> {
    const url = new URL(TOKEN_ENDPOINT)
    url.searchParams.set('grant_type', 'client_credential')
    url.searchParams.set('appid', appId)
    url.searchParams.set('secret', appSecret)

    let response: Response
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法连接微信接口：${errorText(cause)}` }
    }

    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信接口返回 HTTP ${String(response.status)}` }
    }

    let raw: unknown
    try {
        raw = await response.json()
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信接口返回无法解析：${errorText(cause)}` }
    }

    const payload = parseTokenPayload(raw)
    if (payload.kind === 'grant') {
        return { ok: true, token: { accessToken: payload.accessToken, expiresIn: payload.expiresIn } }
    }
    const hint = describeWechatError(payload.errorCode)
    return { ok: false, errorCode: payload.errorCode, message: hint.hint }
}
