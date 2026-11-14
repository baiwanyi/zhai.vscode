/**
 * 链接地址校验：写入侧与打开侧共用同一套协议白名单。
 * 复用约定：纯函数、零前端依赖（扩展宿主 Node 侧也会引用），不得引入 sonner / React / DOM。
 * 关键约束：写入允许站内相对路径（./ ../ / #）原样保留，交给系统打开只认绝对 http(s)/mailto；
 * 未写协议的域名按 https 补全再校验，解析失败（含 javascript: 之类）一律拒绝，不猜。
 */

/** 可写回正文、可交给系统打开器的协议 */
export const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

/** 站内相对地址：不做协议补全，原样保留 */
export const RELATIVE_HREF_PATTERN = /^(?:\.{0,2}\/|#|\/)/u

/** 是否已带协议：用于区分「example.com」与「javascript:alert(1)」 */
const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/iu

/** 规范化可打开地址：非法或非白名单协议返回 null，合法返回标准形式 */
export function parseOpenableUrl(value: string): string | null {
    try {
        const url = new URL(value)
        return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null
    } catch {
        return null
    }
}

/** 能否交给系统打开器：只认绝对地址，相对路径与脚本协议一律拒绝 */
export function isOpenableUrl(value: string): boolean {
    return parseOpenableUrl(value) !== null
}

/** 规范化写入侧链接：站内相对路径原样返回，未写协议的补 https，非法协议返回 null */
export function normalizeHref(input: string): string | null {
    const value = input.trim()
    if (value.length === 0) {
        return null
    }
    if (RELATIVE_HREF_PATTERN.test(value)) {
        return value
    }
    return parseOpenableUrl(HAS_PROTOCOL.test(value) ? value : `https://${value}`)
}
