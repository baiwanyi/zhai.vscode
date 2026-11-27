/**
 * 菜单链接地址：协议读写、展示剥离与输入校验，供内容编辑器与内容完整性校验共用。
 * 复用约定：协议口径与宿主 readMenuLinkUrl 一致，只放行 http/https；纯函数，不读状态不发请求；
 * 输入校验在拼接协议后走 isHttpUrl，展示前缀与写入协议同源。
 * 关键约束：缺省或非法值一律回落 https，历史 http 数据不被静默升级；解析失败返回空串由调用方兜底。
 */

/** 链接协议：展示前缀与写入值同源，http 为存量数据，缺省按 https 处理 */
export type LinkProtocol = 'http' | 'https'

/** 从地址读出协议：仅 http 返回 http，其余（含缺省）一律 https */
export function readLinkProtocol(link: string | undefined): LinkProtocol {
    return link !== undefined && /^http:\/\//i.test(link) ? 'http' : 'https'
}

/** 输入框只展示协议之后的地址，前缀由 InputGroupAddon 按当前协议渲染 */
export function readLinkHost(linkUrl: string | undefined): string {
    return linkUrl === undefined ? '' : linkUrl.replace(/^https?:\/\//i, '')
}

/**
 * 输入时保留粘贴的协议，未带协议则沿用当前数据协议；写入前按宿主同口径校验，
 * 非 http/https 的 scheme 与解析失败的地址返回空串，避免整棵菜单在保存时才被拒。
 */
export function readLinkInput(value: string, currentProtocol: LinkProtocol): string {
    const text = value.trim()
    if (text.length === 0) {
        return ''
    }
    const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(text)
    if (scheme !== null && !/^https?:\/\//i.test(text)) {
        return ''
    }
    const protocol = scheme === null ? currentProtocol : readLinkProtocol(text)
    const host = text.replace(/^https?:\/\//i, '').trim()
    if (host.length === 0) {
        return ''
    }
    const link = `${protocol}://${host}`
    return isHttpUrl(link) ? link : ''
}

/** 链接是否为合法 http/https 地址，link 与小程序兜底网页共用 */
export function isHttpUrl(value: string | undefined): boolean {
    const url = (value ?? '').trim()
    if (url.length === 0) {
        return false
    }
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}
