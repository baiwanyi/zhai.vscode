/**
 * 微博面板（编辑区）：在编辑器区域打开独立 webview 页，承载关注时间线与 Cookie 配置。
 * 复用约定：HTML 与 CSP 注入走 common/webviewHtml，与仪表盘、富文本编辑器共用同一份构建产物加载逻辑；
 * 消息协议复用 shared/types/messages 的 request/response 形状，方法名受 HostMethodName 约束；
 * 面板标识取 shared/types/workflow，工作流路由用它把「活跃标签是微博」映射为微博语境。
 * 关键约束：Cookie 存在 SecretStorage，本层只把 WeiboCookieStore 交给路由，明文不出宿主；
 * 图床按 Referer 放行，图片经 mediaProxy 落本地后内联成 data URI，故不必放开远程图片 CSP；
 * 视频不落缓存：CSP 的 media-src 放行微博视频 CDN，由 Webview 直接播整段 mp4，面板无需授权任何缓存目录；
 * 面板激活、失焦与销毁都要经 activeDocument 上报/让位，关闭时同时清理事实与句柄。
 */
import * as vscode from 'vscode'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import { getActivePanel, reportActivePanel } from '@modules/editor/activeDocument'
import { isRequestMessage } from '@shared/types/messages'
import { WEIBO_PANEL_VIEW_TYPE } from '@shared/types/workflow'
import { createWeiboMediaProxy, readImageAsDataUrl } from './mediaProxy'
import { createWeiboVideoServer } from './videoServer'
import { WeiboWebError } from './webClient'
import { EMPTY_COOKIE_STORE, createWeiboCookieStore } from './webCredential'
import { createWeiboAvatarGateway } from './weiboAvatar'
import { createWeiboCache } from './weiboCache'
import { WeiboRoutes as WeiboRoutesImpl } from './weiboRoutes'
import type { WeiboMediaProxy } from './mediaProxy'
import type { WeiboRoutes } from './weiboRoutes'

/** 图片缓存子目录：与其它模块的缓存共处 globalStorage 根下 */
const MEDIA_CACHE_DIR_NAME = 'weibo-media'

/**
 * 读取代理地址：VS Code 的 http.proxy 优先，其次进程环境变量。
 * 关键约束：只接受 http/https 代理；socks 等其它协议交给直连，避免把不支持的类型塞进隧道。
 */
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

/** 代理与直连是否校验证书：VS Code 关闭严格校验时放开（企业抓包代理的常见配置） */
function readStrictSsl(): boolean {
    return vscode.workspace.getConfiguration('http').get<boolean>('proxyStrictSSL') ?? true
}

/**
 * 创建图片代理：缓存落 globalStorage 下的 weibo-media，代理与证书策略跟随 VS Code 配置。
 * 复用约定：面板取图与激活预热共用这一份构造，避免两处各写一遍 cacheDir 与代理读取。
 */
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

/** 当前面板：关闭后置空，重复打开时聚焦而不是再开一页 */
let current: vscode.WebviewPanel | null = null

/**
 * 处理面板请求：按 reqId 回包，失败时保留错误分类码。
 * 关键约束：非协议消息直接丢弃；错误文案不含 Cookie；未登记方法由路由抛错，这里统一转成 ok:false。
 */
async function handlePanelMessage(panel: vscode.WebviewPanel, routes: WeiboRoutes, message: unknown): Promise<void> {
    if (!isRequestMessage(message)) {
        return
    }
    const { reqId, method, payload } = message
    try {
        const result = await routes.handle(method, payload)
        await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: result })
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        const code = error instanceof WeiboWebError ? error.code : method
        logger.error(`微博面板请求处理失败：${method}`, error)
        await panel.webview.postMessage({ type: 'response', reqId, ok: false, error: { code, message: text } })
    }
}

/**
 * 打开微博面板：已存在则聚焦，否则在编辑区新开一页。
 * secrets 缺省时凭证读写退化为空实现；mediaCacheRoot 缺省时不代理图片（卡片显示占位）。
 */
export async function openWeiboPanel(
    extensionUri: vscode.Uri,
    secrets?: vscode.SecretStorage,
    mediaCacheRoot?: vscode.Uri,
): Promise<void> {
    if (current !== null) {
        current.reveal()
        return
    }
    const webviewDist = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
    const panel = vscode.window.createWebviewPanel(WEIBO_PANEL_VIEW_TYPE, '微博', vscode.ViewColumn.Active, {
        enableScripts: true,
        // 切到其它 tab 再回来不重建页面：时间线滚动位置与已加载内容活在前端状态里，重建会直接丢掉
        retainContextWhenHidden: true,
        // 图片走 data URI、视频由 Webview 直接播 CDN 整段 mp4，两者都不经本地文件，故不授权缓存目录
        localResourceRoots: [webviewDist],
    })
    current = panel
    // 标签图标用固定品牌红：SVG 里写死颜色，不跟随主题分两套
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'icons', 'weibo-tab.svg')

    const cookieStore = secrets === undefined ? EMPTY_COOKIE_STORE : createWeiboCookieStore(secrets)
    // 图床偶发要求登录态：代理在 401/403 时带 Cookie 重试一次；网络按代理 → 直连 → fetch 降级
    const proxy =
        mediaCacheRoot === undefined
            ? null
            : createWeiboMediaResolver(mediaCacheRoot, async (): Promise<string | undefined> => cookieStore.read())
    // 视频中转：CDN 校验 Referer 而 Webview 改不了请求头，故起一个只绑回环的本地服务流式转发（不落盘）；
    // 起不来（端口受限等）就退化为前端「打开原文」，不影响面板其余功能
    const videoServer = await createWeiboVideoServer().catch((error: unknown) => {
        logger.warn(`微博视频中转服务启动失败：${error instanceof Error ? error.message : String(error)}`)
        return null
    })
    // 元数据与头像都落文档存储根：每次打开面板求值，切换文档目录后重开即生效
    const storageRoot = resolveStorageRoot()
    const routes = new WeiboRoutesImpl({
        cookieStore,
        // 同城城市落 VS Code 配置：跨窗口与重启都保留，也可在工作区设置里覆盖
        readCityCode: (): string => getZhaiConfig().weiboCityCode,
        writeCityCode: async (cityCode: string): Promise<void> => {
            await vscode.workspace
                .getConfiguration('zhai')
                .update('weibo.cityCode', cityCode, vscode.ConfigurationTarget.Global)
        },
        cache: createWeiboCache(storageRoot),
        // 头像经同一份图片代理取回后另存为 {存储根}/weibo_avatar.jpg
        avatar: createWeiboAvatarGateway({
            root: storageRoot,
            resolveImage: async (imageUrl: string): Promise<string | null> => {
                if (proxy === null) {
                    return null
                }
                return proxy.resolve(imageUrl)
            },
        }),
        openExternal: async (url: string): Promise<void> => {
            await vscode.env.openExternal(vscode.Uri.parse(url))
        },
        resolveImageUrl:
            proxy === null
                ? undefined
                : async (imageUrl: string): Promise<string | null> => {
                      const filePath = await proxy.resolve(imageUrl)
                      return filePath === null ? null : readImageAsDataUrl(filePath)
                  },
        // 视频：只把 CDN 地址换成回环地址，字节流由本地服务带 Referer 转发，不落缓存
        resolveVideoUrl:
            videoServer === null
                ? undefined
                : (videoUrl: string): Promise<string | null> => Promise.resolve(videoServer.toLocalUrl(videoUrl)),
    })

    // 监听在面板销毁时显式释放：重开面板会重建一份，不释放就叠加处理链
    const messageListener = panel.webview.onDidReceiveMessage((message: unknown) => {
        void handlePanelMessage(panel, routes, message)
    })
    // 面板拿到焦点即上报：工作流区据此切到微博语境；切走时让位，编辑器重新激活由活跃文档侧统一清空
    if (panel.active) {
        reportActivePanel(WEIBO_PANEL_VIEW_TYPE)
    }
    panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
            reportActivePanel(WEIBO_PANEL_VIEW_TYPE)
            return
        }
        if (getActivePanel() === WEIBO_PANEL_VIEW_TYPE) {
            reportActivePanel(null)
        }
    })
    panel.onDidDispose(() => {
        messageListener.dispose()
        proxy?.dispose()
        videoServer?.dispose()
        if (getActivePanel() === WEIBO_PANEL_VIEW_TYPE) {
            reportActivePanel(null)
        }
        if (current === panel) {
            current = null
        }
    })
    try {
        panel.webview.html = await buildWebviewHtml(panel.webview, extensionUri, 'weibo/index.html')
    } catch (error) {
        panel.webview.html = `<html><body><h3>宅写作</h3><p>微博页面资源缺失，请先执行 pnpm run compile（${String(
            error,
        )}）</p></body></html>`
        logger.error('微博面板资源加载失败', error)
    }
}
