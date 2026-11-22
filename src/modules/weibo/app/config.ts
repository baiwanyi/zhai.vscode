/**
 * 微博面板的宿主配置适配：把 VS Code 的代理与证书策略翻译成图片代理的构造参数。
 * 复用约定：缓存目录固定在 globalStorage 下的 weibo-media，面板取图与激活预热共用同一份构造，
 * 避免两处各写一遍 cacheDir 与代理读取。
 * 关键约束：只接受 http/https 代理，socks 等协议交给直连；证书校验跟随 VS Code 的 proxyStrictSSL，
 * 仅在用户显式关闭严格校验时放开（企业抓包代理的常见配置）。
 */
import * as vscode from 'vscode'
import type { WeiboMediaProxy } from '../media/imageProxy'
import { createWeiboMediaProxy } from '../media/imageProxy'

/** 图片缓存子目录：与其它模块的缓存共处 globalStorage 根下 */
export const MEDIA_CACHE_DIR_NAME = 'weibo-media'

/** 读取代理地址：VS Code 的 http.proxy 优先，其次进程环境变量 */
function readProxyUrl(): URL | null {
    const configured = vscode.workspace.getConfiguration('http').get<string>('proxy') ?? ''
    const fromEnv =
        process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? ''
    const raw = configured.trim().length > 0 ? configured.trim() : fromEnv.trim()
    if (raw.length === 0) {
        return null
    }
    try {
        const url = new URL(raw)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    } catch {
        return null
    }
}

/** 代理与直连是否校验证书：VS Code 关闭严格校验时放开 */
function readStrictSsl(): boolean {
    return vscode.workspace.getConfiguration('http').get<boolean>('proxyStrictSSL') ?? true
}

/** 创建图片代理：缓存落 globalStorage 下的 weibo-media，代理与证书策略跟随 VS Code 配置 */
export function createWeiboMediaResolver(
    cacheRoot: vscode.Uri,
    readCookie: () => Promise<string | undefined>,
): WeiboMediaProxy {
    return createWeiboMediaProxy({
        cacheDir: vscode.Uri.joinPath(cacheRoot, MEDIA_CACHE_DIR_NAME).fsPath,
        readCookie,
        proxyUrl: readProxyUrl(),
        isStrictSsl: readStrictSsl(),
    })
}
