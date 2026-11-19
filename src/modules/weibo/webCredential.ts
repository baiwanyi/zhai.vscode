/**
 * 微博网页版 Cookie 存取：登录凭证写入 VSCode SecretStorage（系统级加密）。
 * 复用约定：存取接口返回 PromiseLike，与 vscode.SecretStorage 的 Thenable 同形，便于单测替换；
 * 清洗与校验全部在宿主完成，前端只负责把用户粘贴的整串 Cookie 原样上送。
 * 关键约束：Cookie 只写不读回前端，凭证状态仅暴露「是否已配置 + 保存时间」；
 * 任何错误提示与日志都不得拼接 Cookie 内容或片段；保存时间与 Cookie 分键存储，清除时一并删除。
 */
import type * as vscode from 'vscode'

/** SecretStorage 中的 Cookie 键：与公众号密钥的 `zhai.wechat.` 前缀区分 */
const COOKIE_SECRET_KEY = 'zhai.weibo.webCookie'

/** 保存时刻键：仅用于前端展示与排障，不参与鉴权 */
const COOKIE_SAVED_AT_KEY = 'zhai.weibo.webCookieSavedAt'

/** Cookie 串长度上限：正常登录态远小于此值，超出基本可判定为误粘贴了整段请求头或脚本 */
const MAX_COOKIE_LENGTH = 8192

/** 可见 ASCII 白名单：Cookie 只允许可打印字符，出现换行/控制字符一律拒绝 */
const VISIBLE_ASCII_PATTERN = /^[\x20-\x7E]+$/u

/** 登录态关键 Cookie：网页版 ajax 接口靠它识别会话，缺失必然 401 */
const REQUIRED_COOKIE_NAME = 'SUB'

/** Cookie 存取器：所有动作幂等，删除不存在的键不算失败 */
export interface WeiboCookieStore {
    read(): PromiseLike<string | undefined>
    write(cookie: string): PromiseLike<void>
    remove(): PromiseLike<void>
    readSavedAt(): PromiseLike<string | undefined>
    writeSavedAt(savedAt: string): PromiseLike<void>
    removeSavedAt(): PromiseLike<void>
}

/** 由扩展上下文的 SecretStorage 构造 Cookie 存取器 */
export function createWeiboCookieStore(storage: vscode.SecretStorage): WeiboCookieStore {
    return {
        read: (): PromiseLike<string | undefined> => storage.get(COOKIE_SECRET_KEY),
        write: (cookie: string): PromiseLike<void> => storage.store(COOKIE_SECRET_KEY, cookie),
        remove: (): PromiseLike<void> => storage.delete(COOKIE_SECRET_KEY),
        readSavedAt: (): PromiseLike<string | undefined> => storage.get(COOKIE_SAVED_AT_KEY),
        writeSavedAt: (savedAt: string): PromiseLike<void> => storage.store(COOKIE_SAVED_AT_KEY, savedAt),
        removeSavedAt: (): PromiseLike<void> => storage.delete(COOKIE_SAVED_AT_KEY),
    }
}

/** 未配置存储时的空实现：面板在宿主未注入 SecretStorage 时仍可打开并给出明确提示 */
export const EMPTY_COOKIE_STORE: WeiboCookieStore = {
    read: (): PromiseLike<string | undefined> => Promise.resolve(undefined),
    write: (): PromiseLike<void> => Promise.resolve(),
    remove: (): PromiseLike<void> => Promise.resolve(),
    readSavedAt: (): PromiseLike<string | undefined> => Promise.resolve(undefined),
    writeSavedAt: (): PromiseLike<void> => Promise.resolve(),
    removeSavedAt: (): PromiseLike<void> => Promise.resolve(),
}

/**
 * 清洗用户粘贴的 Cookie：
 * 兼容 DevTools 的换行展示与请求头的 `Cookie:` 前缀，产出 `k=v; k=v` 单行串。
 * 校验失败抛出带原因的中文错误，不含任何输入片段。
 */
export function normalizeCookieInput(raw: string): string {
    const withoutPrefix = raw.replace(/^\uFEFF/u, '').replace(/^\s*cookie\s*:/iu, '')
    const flattened = withoutPrefix.replace(/[\r\n\t]+/gu, '; ')
    const pairs = flattened
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    if (pairs.length === 0) {
        throw new Error('Cookie 为空：请从浏览器开发者工具的请求头中复制完整 Cookie')
    }
    const cookie = pairs.join('; ')
    if (cookie.length > MAX_COOKIE_LENGTH) {
        throw new Error(`Cookie 过长（超过 ${String(MAX_COOKIE_LENGTH)} 字符）：请确认复制的是请求头而不是整段页面数据`)
    }
    if (!VISIBLE_ASCII_PATTERN.test(cookie)) {
        throw new Error('Cookie 含不可见字符：请重新从开发者工具复制，避免带入换行或控制字符')
    }
    if (!pairs.some((pair) => pair.startsWith(`${REQUIRED_COOKIE_NAME}=`))) {
        throw new Error(
            'Cookie 缺少登录态字段 SUB：请先在浏览器登录 weibo.com，再从任意 ajax 请求的请求头中复制完整 Cookie',
        )
    }
    return cookie
}

/** 判断存储中的 Cookie 是否可直接用于请求 */
export function isCookieUsable(cookie: string | undefined): cookie is string {
    return typeof cookie === 'string' && cookie.length > 0
}
