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

/** 永久图片素材接口 */
const MATERIAL_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/material/add_material'

/** 素材上传超时：图片可达数 MB，比鉴权放宽，但必须有上限 */
const UPLOAD_TIMEOUT_MS = 60_000

/** 上传图片的入参：调用方负责读出字节与判定 MIME */
export interface WechatImageUploadInput {
    bytes: Uint8Array
    fileName: string
    mimeType: string
}

/** 素材上传结果：成功返回可访问 URL 与 media_id，失败返回归一后的提示 */
export type WechatMaterialOutcome =
    { ok: true; mediaId: string; url: string } | { ok: false; errorCode: number; message: string }

/** 素材类错误码的专属提示：与鉴权的错误语义不同，不能复用鉴权文案 */
const MATERIAL_ERROR_HINTS: Readonly<Record<string, string>> = {
    '40005': '图片格式不支持，请改用 jpg 或 png',
    '40006': '图片超过 10MB 上限，请压缩后再试',
    '40007': '图片文件无效，请确认文件未损坏',
    '45009': '素材接口今日额度已用完，请明天再试或复用已有素材',
    '40164': '调用方 IP 不在白名单：请把当前出口 IP 加入公众号后台的 IP 白名单',
}

/** 素材错误码 → 可执行提示：未登记的码给出通用说明，不透出英文 errmsg */
function describeMaterialError(errorCode: number): string {
    return MATERIAL_ERROR_HINTS[String(errorCode)] ?? '素材上传失败，请稍后重试或更换图片'
}

/** 收窄素材响应：成功必须有 media_id 与 url */
function parseMaterialPayload(
    raw: unknown,
): { kind: 'ok'; mediaId: string; url: string } | { kind: 'error'; errorCode: number } {
    if (typeof raw !== 'object' || raw === null) {
        return { kind: 'error', errorCode: -1 }
    }
    const candidate = raw as { media_id?: unknown; url?: unknown; errcode?: unknown }
    if (typeof candidate.media_id === 'string' && candidate.media_id.length > 0 && typeof candidate.url === 'string') {
        return { kind: 'ok', mediaId: candidate.media_id, url: candidate.url }
    }
    return { kind: 'error', errorCode: typeof candidate.errcode === 'number' ? candidate.errcode : -1 }
}

/** 草稿箱接口：新增与更新同一份内容的不同动作 */
const DRAFT_ADD_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/draft/add'
const DRAFT_UPDATE_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/draft/update'

/** 草稿提交超时：正文可能较大，比鉴权放宽 */
const DRAFT_TIMEOUT_MS = 30_000

/** 单篇草稿内容：字段名按平台要求映射为 snake_case */
export interface WechatDraftArticle {
    title: string
    author: string
    digest: string
    /** 内联样式后的正文 HTML */
    content: string
    /** 封面素材 ID：平台强制要求 */
    thumbMediaId: string
    needOpenComment: boolean
    onlyFansCanComment: boolean
}

/** 草稿提交结果 */
export type WechatDraftOutcome = { ok: true; mediaId: string } | { ok: false; errorCode: number; message: string }

/** 草稿类错误码的专属提示：与鉴权、素材的语义不同，不能复用 */
const DRAFT_ERROR_HINTS: Readonly<Record<string, string>> = {
    '40007': '素材或草稿 ID 无效，请重新生成草稿',
    '45166': '正文内容未通过平台校验，请检查敏感词与外部链接',
    '45009': '接口调用超过当日额度，请稍后再试',
    '40164': '调用方 IP 不在白名单：请把当前出口 IP 加入公众号后台的 IP 白名单',
    '40001': 'AppSecret 不正确或已被重置，请重新填写密钥',
}

/** 草稿错误码 → 可执行提示 */
export function describeDraftError(errorCode: number): string {
    return DRAFT_ERROR_HINTS[String(errorCode)] ?? '草稿提交失败，请稍后重试'
}

/** 收窄草稿响应：成功必须带 media_id */
function parseDraftPayload(raw: unknown): { kind: 'ok'; mediaId: string } | { kind: 'error'; errorCode: number } {
    if (typeof raw !== 'object' || raw === null) {
        return { kind: 'error', errorCode: -1 }
    }
    const candidate = raw as { media_id?: unknown; errcode?: unknown }
    if (typeof candidate.media_id === 'string' && candidate.media_id.length > 0) {
        return { kind: 'ok', mediaId: candidate.media_id }
    }
    return { kind: 'error', errorCode: typeof candidate.errcode === 'number' ? candidate.errcode : -1 }
}

/**
 * 提交草稿：传 mediaId 时更新既有草稿，否则新建。
 * 关键约束：平台不支持幂等键，重复调用会新增草稿，是否复用由调用方按本地 media_id 决定；
 * 请求体字段名必须与平台一致（thumb_media_id / need_open_comment 等），拼错会被静默忽略。
 */
export async function submitWechatDraft(
    token: string,
    articles: WechatDraftArticle[],
    mediaId?: string,
): Promise<WechatDraftOutcome> {
    const isUpdate = mediaId !== undefined && mediaId.length > 0
    const url = new URL(isUpdate ? DRAFT_UPDATE_ENDPOINT : DRAFT_ADD_ENDPOINT)
    url.searchParams.set('access_token', token)

    const payloadArticles = articles.map((article) => ({
        title: article.title,
        author: article.author,
        digest: article.digest,
        content: article.content,
        content_source_url: '',
        thumb_media_id: article.thumbMediaId,
        need_open_comment: article.needOpenComment ? 1 : 0,
        only_fans_can_comment: article.onlyFansCanComment ? 1 : 0,
    }))
    const body = isUpdate ? { media_id: mediaId, index: 0, articles: payloadArticles } : { articles: payloadArticles }

    let response: Response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
        })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法连接微信草稿接口：${errorText(cause)}` }
    }
    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信草稿接口返回 HTTP ${String(response.status)}` }
    }

    let raw: unknown
    try {
        raw = await response.json()
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信草稿接口返回无法解析：${errorText(cause)}` }
    }

    const payload = parseDraftPayload(raw)
    if (payload.kind === 'ok') {
        return { ok: true, mediaId: payload.mediaId }
    }
    return { ok: false, errorCode: payload.errorCode, message: describeDraftError(payload.errorCode) }
}

/** 发布接口：提交异步发布任务与查询其结果 */
const FREEPUBLISH_SUBMIT_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/freepublish/submit'
const FREEPUBLISH_GET_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/freepublish/get'

/** 发布相关超时：提交是异步任务，接口本身很快；查询同样轻量 */
const PUBLISH_TIMEOUT_MS = 20_000

/** 提交发布的结果 */
export type WechatFreepublishOutcome =
    { ok: true; publishId: string } | { ok: false; errorCode: number; message: string }

/** 发布状态：pending 表示平台仍在处理，调用方据此决定是否继续轮询 */
export type WechatPublishState =
    | { ok: true; state: 'published'; articleUrl?: string }
    | { ok: true; state: 'pending' }
    | { ok: true; state: 'failed'; message: string }
    | { ok: false; errorCode: number; message: string }

/** 发布类错误码的专属提示：未认证主体是最常见的失败原因，提示要直接给出替代路径 */
const PUBLISH_ERROR_HINTS: Readonly<Record<string, string>> = {
    '48001': '该账号没有发布权限，通常是未认证主体：草稿已在后台，请到公众号后台手动群发',
    '45009': '群发次数已用完：订阅号每天 1 次、服务号每月 4 次，请等额度恢复后再发',
    '40164': '调用方 IP 不在白名单：请把当前出口 IP 加入公众号后台的 IP 白名单',
    '40001': 'AppSecret 不正确或已被重置，请重新填写密钥',
    '53503': '内容未通过平台审核，请检查敏感词与外部链接',
    '53504': '内容未通过平台审核，请检查敏感词与外部链接',
}

/** 发布错误码 → 可执行提示 */
export function describePublishError(errorCode: number): string {
    return PUBLISH_ERROR_HINTS[String(errorCode)] ?? '群发失败，请稍后重试'
}

/** 发布状态码 → 语义：0 成功、1 发布中、其余按失败处理并给出平台失败类型 */
function readPublishState(code: number): { state: 'published' | 'pending' | 'failed'; message: string } {
    switch (code) {
        case 0:
            return { state: 'published', message: '' }
        case 1:
            return { state: 'pending', message: '' }
        case 2:
            return { state: 'failed', message: '原创校验未通过，请到公众号后台查看原因' }
        case 4:
            return { state: 'failed', message: '内容未通过平台审核，请检查敏感词与外部链接' }
        case 5:
        case 6:
            return { state: 'failed', message: '发布内容已被删除，请到公众号后台确认' }
        default:
            return { state: 'failed', message: '平台发布失败，请到公众号后台查看原因' }
    }
}

/**
 * 提交群发：把草稿箱里的 media_id 交给平台异步发布。
 * 关键约束：接口成功只代表「任务已受理」，真正是否发布成功要看 freepublish/get；
 * 未认证主体会返回 48001，此处按可执行提示返回，不作为异常抛出。
 */
export async function submitWechatFreepublish(token: string, mediaId: string): Promise<WechatFreepublishOutcome> {
    const url = new URL(FREEPUBLISH_SUBMIT_ENDPOINT)
    url.searchParams.set('access_token', token)

    let response: Response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_id: mediaId }),
            signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
        })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法连接微信发布接口：${errorText(cause)}` }
    }
    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信发布接口返回 HTTP ${String(response.status)}` }
    }

    let raw: unknown
    try {
        raw = await response.json()
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信发布接口返回无法解析：${errorText(cause)}` }
    }

    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, errorCode: -1, message: describePublishError(-1) }
    }
    const candidate = raw as { publish_id?: unknown; errcode?: unknown }
    if (typeof candidate.publish_id === 'string' && candidate.publish_id.length > 0) {
        return { ok: true, publishId: candidate.publish_id }
    }
    const errorCode = typeof candidate.errcode === 'number' ? candidate.errcode : -1
    return { ok: false, errorCode, message: describePublishError(errorCode) }
}

/**
 * 查询发布状态：成功后回传首篇文章的永久链接，供界面跳转查看。
 * 关键约束：article_detail 可能缺省（发布中），此时只返回 pending，不猜测结果。
 */
export async function fetchWechatPublishState(token: string, publishId: string): Promise<WechatPublishState> {
    const url = new URL(FREEPUBLISH_GET_ENDPOINT)
    url.searchParams.set('access_token', token)

    let response: Response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publish_id: publishId }),
            signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
        })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法查询发布状态：${errorText(cause)}` }
    }
    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `发布状态接口返回 HTTP ${String(response.status)}` }
    }

    let raw: unknown
    try {
        raw = await response.json()
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `发布状态返回无法解析：${errorText(cause)}` }
    }
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, errorCode: -1, message: '发布状态返回格式异常' }
    }

    const candidate = raw as {
        errcode?: unknown
        publish_status?: unknown
        article_detail?: { item?: { article_url?: unknown }[] }
    }
    if (typeof candidate.errcode === 'number' && candidate.errcode !== 0) {
        return { ok: false, errorCode: candidate.errcode, message: describePublishError(candidate.errcode) }
    }
    const statusCode = typeof candidate.publish_status === 'number' ? candidate.publish_status : -1
    const outcome = readPublishState(statusCode)
    if (outcome.state === 'published') {
        const firstUrl = candidate.article_detail?.item?.[0]?.article_url
        return { ok: true, state: 'published', ...(typeof firstUrl === 'string' ? { articleUrl: firstUrl } : {}) }
    }
    if (outcome.state === 'pending') {
        return { ok: true, state: 'pending' }
    }
    return { ok: true, state: 'failed', message: outcome.message }
}

/**
 * 上传图片为永久素材。
 * 关键约束：走 multipart/form-data，字段名必须是 media；token 只出现在查询串中，不写日志；
 * 返回的 url 是微信侧可访问地址，可直接写进正文 img 的 src。
 */
export async function uploadWechatImageMaterial(
    token: string,
    input: WechatImageUploadInput,
): Promise<WechatMaterialOutcome> {
    const url = new URL(MATERIAL_ENDPOINT)
    url.searchParams.set('access_token', token)
    url.searchParams.set('type', 'image')

    const form = new FormData()
    form.append('media', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName)

    let response: Response
    try {
        response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法连接微信素材接口：${errorText(cause)}` }
    }
    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信素材接口返回 HTTP ${String(response.status)}` }
    }

    let raw: unknown
    try {
        raw = await response.json()
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信素材接口返回无法解析：${errorText(cause)}` }
    }

    const payload = parseMaterialPayload(raw)
    if (payload.kind === 'ok') {
        return { ok: true, mediaId: payload.mediaId, url: payload.url }
    }
    return { ok: false, errorCode: payload.errorCode, message: describeMaterialError(payload.errorCode) }
}
