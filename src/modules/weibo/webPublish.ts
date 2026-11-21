/**
 * 微博发布：先把本地图片逐张传图床换 pid，再用 formdata 提交正文与 pid。
 * 复用约定：Cookie / UA / Referer 与时间线同源，XSRF 头口径沿用 webInteraction；
 * 图床与发布端点登记在 weiboEndpoints，地址拼装、表单构造与响应解析都拆成纯函数便于单测。
 * 关键约束：图床走 pic_upload.php——元数据全在 query、body 直接放图片字节、不需要签名参数；
 * 成功判定是拿到 pid（回包 code=A00006，pid 在 data.pics.*.pid）；图片按入参顺序逐张上传，
 * 任一失败即整条放弃（不做部分发布）；写操作一律不重试；错误文案不得包含 Cookie。
 */
import type { WeiboPublishResult } from '@shared/types/weibo'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from './webClient'
import { readXsrfToken } from './webInteraction'
import { normalizeTimelinePost } from './webTimeline'
import {
    WEIBO_AJAX_PATHS,
    WEIBO_PIC_UPLOAD_ORIGIN,
    WEIBO_PIC_UPLOAD_PATH,
    WEIBO_WEB_ORIGIN,
    WEIBO_WEB_REFERER,
} from './weiboEndpoints'

/** 单张图片上传超时：几十 KB 到几 MB，30s 足够 */
const UPLOAD_TIMEOUT_MS = 30_000

/** 发布请求超时：正文与 pid 都很小，超时即网络异常 */
const PUBLISH_TIMEOUT_MS = 30_000

/** 指纹长度：网页端 fp 固定 33 位，首位是分区标记 0 */
const FINGERPRINT_LENGTH = 33

/** 指纹字符集：与网页端一致的大小写字母 + 数字 */
const FINGERPRINT_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 待上传图片：字节与已按魔数判定的 MIME */
export interface WeiboUploadImage {
    bytes: Uint8Array
    /** image/png、image/jpeg、image/webp、image/gif */
    mimeType: string
}

/** 发布入参：正文原样提交，图片逐张传图床换 pid */
export interface PublishWeiboOptions {
    cookie: string
    content: string
    images: readonly WeiboUploadImage[]
    timeoutMs?: number
    fetcher?: typeof fetch
    random?: () => number
}

/** 发布表单里的图片项：type 为 MIME，pid 为图床返回的图片标识 */
export interface PublishPic {
    type: string
    pid: string
}

/** 发布表单入参 */
export interface PublishFormInput {
    content: string
    pics: readonly PublishPic[]
    /** fp：网页端设备指纹，同形随机生成 */
    fingerprint: string
}

/** 上传上下文：把重复参数收成一处 */
interface UploadContext {
    cookie: string
    fetcher: typeof fetch
    timeoutMs: number
}

/**
 * 生成设备指纹：与网页端 fp 同形（33 位、首位 0）。
 * 关键约束：无法还原官方指纹算法，这里只保证形态合法；若上游开始校验指纹与 Cookie 的绑定关系，
 * 该参数需要换成从浏览器会话里取到的真实值。
 */
export function buildWeiboFingerprint(random: () => number): string {
    let fingerprint = '0'
    while (fingerprint.length < FINGERPRINT_LENGTH) {
        const index = Math.floor(random() * FINGERPRINT_ALPHABET.length)
        fingerprint += FINGERPRINT_ALPHABET[index] ?? '0'
    }
    return fingerprint
}

/**
 * 构造图床上传地址（pic_upload.php）：该端点不需要签名参数，
 * 元数据全在 query、body 直接放图片字节；成功回 `{code:'A00006', data:{pics:{pic_1:{pid}}}}`。
 */
export function buildUploadUrl(mimeType: string): string {
    const url = new URL(WEIBO_PIC_UPLOAD_PATH, WEIBO_PIC_UPLOAD_ORIGIN)
    url.searchParams.set('s', 'json')
    url.searchParams.set('ori', '1')
    url.searchParams.set('data', '1')
    url.searchParams.set('rotate', '0')
    url.searchParams.set('wm', '')
    url.searchParams.set('app', 'miniblog')
    url.searchParams.set('mime', mimeType)
    return url.toString()
}

/** 读取对象字段：非对象（数组、null、原始值）一律返回 null */
function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

/**
 * 从回包里找 pid：主路径是 data.pics.*.pid；
 * 兼容 pic.pid（可为数组）、data.pid 与顶层 pid，避免上游结构微调时整条失败。
 */
function readPicPid(record: Record<string, unknown>): string {
    const data = asRecord(record.data)
    if (data !== null) {
        const pics = asRecord(data.pics)
        if (pics !== null) {
            for (const value of Object.values(pics)) {
                const entry = asRecord(value)
                const entryPid = entry !== null && typeof entry.pid === 'string' ? entry.pid.trim() : ''
                if (entryPid.length > 0) {
                    return entryPid
                }
            }
        }
        const nested = typeof data.pid === 'string' ? data.pid.trim() : ''
        if (nested.length > 0) {
            return nested
        }
    }
    const rawPic: unknown = record.pic
    const list: unknown[] | null = Array.isArray(rawPic) ? (rawPic as unknown[]) : null
    const container = asRecord(list === null ? rawPic : list[0])
    const pid = container !== null && typeof container.pid === 'string' ? container.pid.trim() : ''
    if (pid.length > 0) {
        return pid
    }
    return typeof record.pid === 'string' ? record.pid.trim() : ''
}

/**
 * 汇总失败现场：图床的失败回包各家写法不同，把 ret / code / 字段名与原文前 200 字带进错误，
 * 用户复测时能直接看出是参数被拒、接口下线还是登录态问题。
 */
function describeUploadFailure(record: Record<string, unknown>, raw: string): string {
    const code = record.code
    const parts: string[] = []
    if (typeof code === 'string' || typeof code === 'number') {
        parts.push(`code=${String(code)}`)
    }
    const keys = Object.keys(record).slice(0, 8).join('、')
    parts.push(keys.length > 0 ? `字段=${keys}` : '空对象')
    const head = raw.trim().replace(/\s+/gu, ' ').slice(0, 200)
    if (head.length > 0) {
        parts.push(`原文=${head}`)
    }
    return parts.join('，')
}

/**
 * 解析图床回包：拿到 pid 即视为成功（成功码 code=A00006，部分分支只有 pid），
 * 失败时错误里带失败现场。
 */
export function readPidFromUpload(record: Record<string, unknown>, raw = ''): string {
    const pid = readPicPid(record)
    if (pid.length > 0) {
        return pid
    }
    const message =
        typeof record.errmsg === 'string' && record.errmsg.length > 0
            ? record.errmsg
            : typeof record.msg === 'string' && record.msg.length > 0
              ? record.msg
              : '图床没有返回 pid'
    throw new WeiboWebError('upstream', `图片上传失败：${message}（${describeUploadFailure(record, raw)}）`)
}

/** 构造发布表单：写操作参数全部显式给出，空值也保留键，与网页端一致 */
export function buildPublishForm(input: PublishFormInput): URLSearchParams {
    const form = new URLSearchParams()
    form.set('content', input.content)
    form.set('visible', '0')
    form.set('share_id', '')
    form.set('vote', '')
    form.set('media', '')
    form.set('need_transcode', '1')
    form.set('pic_id', input.pics.length === 0 ? '' : JSON.stringify(input.pics))
    form.set('fp', input.fingerprint)
    return form
}

/** 解析发布回包：ok>0 且 data 带 id 与 mblogid 才算成功 */
export function readPublishResult(record: Record<string, unknown>): WeiboPublishResult {
    const ok = record.ok
    if (typeof ok !== 'number' || ok <= 0) {
        const message = typeof record.msg === 'string' ? record.msg : '未知错误'
        const code =
            message.includes('频繁') || message.includes('过快') || message.includes('太多')
                ? 'rate-limited'
                : 'upstream'
        throw new WeiboWebError(code, `发布失败：${message}`)
    }
    const data = typeof record.data === 'object' && record.data !== null ? (record.data as Record<string, unknown>) : {}
    const id =
        typeof data.idstr === 'string' && data.idstr.length > 0
            ? data.idstr
            : typeof data.id === 'number'
              ? String(data.id)
              : ''
    const mblogid = typeof data.mblogid === 'string' ? data.mblogid : ''
    if (id.length === 0 || mblogid.length === 0) {
        throw new WeiboWebError('invalid-payload', '发布返回结构异常：缺少微博 id 或 mblogid')
    }
    const user = typeof data.user === 'object' && data.user !== null ? (data.user as Record<string, unknown>) : {}
    const uid = typeof user.idstr === 'string' ? user.idstr : ''
    return {
        id,
        mblogid,
        url: uid.length > 0 ? `${WEIBO_WEB_ORIGIN}/${uid}/${mblogid}` : `${WEIBO_WEB_ORIGIN}/detail/${id}`,
        // 上游返回的就是一条完整微博：归一化后交给前端前插，发布成功不必整页刷新
        post: normalizeTimelinePost(data),
    }
}

/** 图床请求头：只带 Cookie / Referer / Origin / UA / Accept */
function buildUploadHeaders(cookie: string): Record<string, string> {
    return {
        Cookie: cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
    }
}

/** 发布请求头：写操作，补 XHR 标记与 XSRF（Cookie 里没有该键时不带） */
function buildPublishHeaders(cookie: string): Record<string, string> {
    const headers = buildUploadHeaders(cookie)
    headers['X-Requested-With'] = 'XMLHttpRequest'
    const xsrfToken = readXsrfToken(cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }
    return headers
}

/** 状态码分类：登录态与频控分开，便于前端给出不同引导 */
function classifyStatus(status: number, subject: string): WeiboWebError {
    if (status === 401 || status === 403) {
        return new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', status)
    }
    if (status === 404) {
        return new WeiboWebError('upstream', `${subject}接口不存在（HTTP 404）：该端点可能已下线`, status)
    }
    if (status === 418 || status === 429) {
        return new WeiboWebError('rate-limited', `${subject}过于频繁：请稍后再试`, status)
    }
    return new WeiboWebError('upstream', `${subject}失败：HTTP ${String(status)}`, status)
}

/** 从 HTML 里取标题：排障时能一眼看出是登录页还是 404 页 */
function readHtmlTitle(text: string): string {
    const matched = /<title[^>]*>([\s\S]{0,80}?)<\/title>/iu.exec(text)
    return matched?.[1]?.replace(/\s+/gu, ' ').trim() ?? ''
}

/**
 * 解析 JSON 响应：非法 JSON 转成 invalid-payload，HTML 页面按调用方语义分类。
 * 关键约束：只有发布接口的 HTML 才当作登录页（未登录会 302 到 passport，跟随后拿到登录 HTML）；
 * 图床域名的 HTML 多是接口下线或被风控拦截的错误页，误报「登录态失效」会把人带偏。
 */
function parseWeiboRecord(
    text: string,
    status: number,
    subject: string,
    htmlMeansLogin = false,
): Record<string, unknown> {
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
        if (htmlMeansLogin) {
            throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', status)
        }
        const title = readHtmlTitle(trimmed)
        throw new WeiboWebError(
            'upstream',
            `${subject}返回了 HTML 页面（HTTP ${String(status)}${title.length > 0 ? `，标题：${title}` : ''}）：接口可能已下线或被风控拦截`,
            status,
        )
    }
    const parsed = tryParseJson(trimmed)
    if (parsed === undefined) {
        throw new WeiboWebError('invalid-payload', `${subject}返回无法解析：接口可能已改版`, status)
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new WeiboWebError('invalid-payload', `${subject}返回结构异常：缺少 JSON 对象`, status)
    }
    return parsed as Record<string, unknown>
}

/**
 * 宽松解析 JSON：图床回包可能带 JSONP 包裹或多余花括号，
 * 先按原文解析，失败再从第一个 { 到最后一个 } 截一段重试。
 */
function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start < 0 || end <= start) {
            return undefined
        }
        try {
            return JSON.parse(text.slice(start, end + 1))
        } catch {
            return undefined
        }
    }
}

/** 单张图片上传：body 直接是图片字节，不需要 multipart 与签名参数 */
async function uploadPicture(context: UploadContext, image: WeiboUploadImage): Promise<string> {
    // BlobPart / BodyInit 只接受 ArrayBuffer 支撑的视图：vscode 读回的是 ArrayBufferLike 视图，
    // 复制一份再提交，避免 SharedArrayBuffer 分支的类型与实现差异
    const payload = new Uint8Array(image.bytes.byteLength)
    payload.set(image.bytes)
    const headers = buildUploadHeaders(context.cookie)
    headers['Content-Type'] = 'application/octet-stream'
    let response: Response
    try {
        response = await context.fetcher(buildUploadUrl(image.mimeType), {
            method: 'POST',
            headers,
            body: payload,
            signal: AbortSignal.timeout(context.timeoutMs),
        })
    } catch {
        throw new WeiboWebError('network', '图片上传失败：请检查网络或代理设置')
    }
    if (!response.ok) {
        throw classifyStatus(response.status, '图片上传')
    }
    const text = await response.text()
    return readPidFromUpload(parseWeiboRecord(text, response.status, '图片上传'), text)
}

/** 发布微博：先传全部图片换 pid，再提交正文与 pid */
export async function publishWeibo(options: PublishWeiboOptions): Promise<WeiboPublishResult> {
    const fetcher = options.fetcher ?? fetch
    const random = options.random ?? Math.random
    const timeoutMs = options.timeoutMs ?? UPLOAD_TIMEOUT_MS
    const pics: PublishPic[] = []
    for (const image of options.images) {
        const pid = await uploadPicture({ cookie: options.cookie, fetcher, timeoutMs }, image)
        pics.push({ type: image.mimeType, pid })
    }
    const headers = buildPublishHeaders(options.cookie)
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const form = buildPublishForm({
        content: options.content,
        pics,
        fingerprint: buildWeiboFingerprint(random),
    })
    let response: Response
    try {
        response = await fetcher(`${WEIBO_WEB_ORIGIN}${WEIBO_AJAX_PATHS.publish}`, {
            method: 'POST',
            headers,
            body: form,
            signal: AbortSignal.timeout(options.timeoutMs ?? PUBLISH_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '发布请求失败：请检查网络或代理设置')
    }
    if (!response.ok) {
        throw classifyStatus(response.status, '发布')
    }
    // 发布接口拿到 HTML 基本就是登录页（未登录会被重定向到 passport），按未登录引导
    return readPublishResult(parseWeiboRecord(await response.text(), response.status, '发布', true))
}
