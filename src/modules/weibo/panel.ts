/**
 * 微博面板（编辑区）：在编辑器区域打开独立 webview 页，承载关注时间线与 Cookie 配置。
 * 复用约定：HTML 与 CSP 注入走 common/webviewHtml，与仪表盘、富文本编辑器共用同一份构建产物加载逻辑；
 * 消息协议复用 shared/types/messages 的 request/response 形状，方法名受 HostMethodName 约束；
 * 面板标识取 shared/types/workflow，工作流路由用它把「活跃标签是微博」映射为微博语境。
 * 关键约束：Cookie 存在 SecretStorage，本层只把 WeiboCookieStore 交给路由，明文不出宿主；
 * 图床按 Referer 放行，图片经 mediaProxy 落本地后内联成 data URI，故不必放开远程图片 CSP；
 * 视频不落缓存：CSP 的 media-src 放行微博视频 CDN，由 Webview 直接播整段 mp4，面板无需授权任何缓存目录；
 * 发表框的 upload/* 转交上传路由（与工作流面板共用同一份实例），ai/enhancePrompt 转交 AI 服务，
 * 微博路由本身不认这两个前缀；
 * 发布前由本层读出 uploads 图片字节（限定路径、按魔数判格式），传图床与提交正文都在 webPublish 内完成；
 * 存储根须列入 localResourceRoots，否则 uploads 缩略图的 asWebviewUri 地址会被拒绝；
 * 面板激活、失焦与销毁都要经 activeDocument 上报/让位，关闭时同时清理事实与句柄。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { sniffImageMime } from '@modules/common/imageSniff'
import { logger } from '@modules/common/logger'
import { buildStorageUri } from '@modules/common/storagePath'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import { getActivePanel, reportActivePanel } from '@modules/editor/activeDocument'
import { MAX_UPLOAD_BYTES } from '@modules/upload/uploadPayload'
import type { UploadRoutes } from '@modules/upload/uploadRoutes'
import { saveUploadFile } from '@modules/upload/uploadStorage'
import { isRequestMessage } from '@shared/types/messages'
import { isUploadPath } from '@shared/types/upload'
import type { WeiboNoteSaveResult, WeiboPagePostPayload } from '@shared/types/weibo'
import { WEIBO_PANEL_VIEW_TYPE } from '@shared/types/workflow'
import { createWeiboMediaProxy, readImageAsDataUrl } from './mediaProxy'
import { createWeiboVideoServer } from './videoServer'
import { WeiboWebError } from './webClient'
import { EMPTY_COOKIE_STORE, createWeiboCookieStore } from './webCredential'
import { createWeiboAvatarGateway } from './weiboAvatar'
import { createWeiboCache } from './weiboCache'
import { WeiboRoutes as WeiboRoutesImpl } from './weiboRoutes'
import type { WeiboMediaProxy } from './mediaProxy'
import type { WeiboImageSaver, WeiboPostActions } from './postActions'
import type { WeiboUploadImage } from './webPublish'
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

/** 日志用的图片标识：只留主机与路径前段，查询串里可能带签名 */
function describeImageUrl(url: string): string {
    try {
        const parsed = new URL(url)
        return `${parsed.host}${parsed.pathname.slice(0, 60)}`
    } catch {
        return '非法地址'
    }
}

/**
 * 创建配图搬运器：把微博图床的远程图搬进 uploads/{YYYYMM}/，与上传页共用同一套命名与落盘规则。
 * 复用约定：取图交给面板的图片代理（补 Referer、401/403 带 Cookie 重试、302 跟随），落盘交给 upload/saveUploadFile；
 * 关键约束：优先按 pid 走官方下载端点取最大尺寸原图，pid 缺失或失败才回退图床直链；
 * 逐张处理，单张失败只回退远程直链，不影响整篇笔记；超过上传单件上限的图同样跳过；
 * 返回值为存储根相对路径（不带 @zhai 前缀），引用写法由 note 组装层决定。
 */
function createWeiboImageSaver(proxy: WeiboMediaProxy): WeiboImageSaver {
    return async (images) => {
        const root = resolveStorageRoot()
        const saved: Array<string | null> = []
        for (const image of images) {
            try {
                const original = image.pid.length > 0 ? await proxy.resolveOriginal(image.pid) : null
                const localPath = original ?? (await proxy.resolve(image.url))
                if (localPath === null) {
                    saved.push(null)
                    continue
                }
                const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath))
                if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
                    logger.warn(
                        `微博配图跳过上传目录：体积 ${String(bytes.byteLength)} 字节（${describeImageUrl(image.url)}）`,
                    )
                    saved.push(null)
                    continue
                }
                const file = await saveUploadFile(root, { name: path.basename(localPath), bytes })
                saved.push(file.path)
            } catch (error) {
                logger.warn(
                    `微博配图保存失败：${describeImageUrl(image.url)}（${error instanceof Error ? error.message : String(error)}）`,
                )
                saved.push(null)
            }
        }
        return saved
    }
}

/** 当前面板：关闭后置空，重复打开时聚焦而不是再开一页 */
let current: vscode.WebviewPanel | null = null

/** AI 改写能力：由扩展入口注入 ChatService.enhancePrompt，发表框的「AI 优化」经它取结果 */
export type WeiboEnhancePrompt = (payload: unknown) => Promise<{ text: string }>

/**
 * 处理面板请求：按 reqId 回包，失败时保留错误分类码。
 * 关键约束：非协议消息直接丢弃；错误文案不含 Cookie；未登记方法由路由抛错，这里统一转成 ok:false。
 */
async function handlePanelMessage(
    panel: vscode.WebviewPanel,
    routes: WeiboRoutes,
    upload: UploadRoutes | undefined,
    enhancePrompt: WeiboEnhancePrompt | undefined,
    message: unknown,
): Promise<void> {
    if (!isRequestMessage(message)) {
        return
    }
    const { reqId, method, payload } = message
    try {
        // upload/* 与工作流面板共用同一份上传路由：发表框的图片选择与粘贴上传要读 uploads 清单、写字节流；
        // ai/enhancePrompt 同理来自 AI 服务（微博路由不认 ai/* 前缀）；
        // 两者未注入时都落到兜底分支并回报「未登记」
        const result =
            method.startsWith('upload/') && upload !== undefined
                ? await upload.handle(method, payload, (uri) => panel.webview.asWebviewUri(uri).toString())
                : method === 'ai/enhancePrompt' && enhancePrompt !== undefined
                  ? await enhancePrompt(payload)
                  : await routes.handle(method, payload)
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
 * secrets 缺省时凭证读写退化为空实现；mediaCacheRoot 缺省时不代理图片（卡片显示占位）；
 * postActions 缺省时卡片的「保存到笔记」「添加到 AI 对话」按未就绪回包，其余功能不受影响；
 * upload 缺省时发表框的图片选择与粘贴上传报未就绪，其余功能照常；
 * enhancePrompt 缺省时发表框的「AI 优化」报未登记，其余功能照常。
 */
export async function openWeiboPanel(
    extensionUri: vscode.Uri,
    secrets?: vscode.SecretStorage,
    mediaCacheRoot?: vscode.Uri,
    postActions?: WeiboPostActions,
    upload?: UploadRoutes,
    enhancePrompt?: WeiboEnhancePrompt,
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
        // 存储根加入白名单：发表框的图片选择与粘贴上传要经 asWebviewUri 渲染 uploads 下的缩略图；
        // 微博正文图片仍走 data URI、视频直接播 CDN 整段 mp4，都不依赖该目录
        localResourceRoots: [webviewDist, resolveStorageRoot()],
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
        // 屏蔽名单同样落 VS Code 配置：两个名单一次写入，避免关窗时只落了一半
        readBlockedUsers: (): string[] => getZhaiConfig().weiboBlockedUsers,
        readBlockedKeywords: (): string[] => getZhaiConfig().weiboBlockedKeywords,
        writeBlockList: async (list): Promise<void> => {
            const config = vscode.workspace.getConfiguration('zhai')
            await config.update('weibo.blockedUsers', list.blockedUsers, vscode.ConfigurationTarget.Global)
            await config.update('weibo.blockedKeywords', list.blockedKeywords, vscode.ConfigurationTarget.Global)
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
        // 卡片动作：笔记落盘与 AI 会话都在宿主其它层，面板只补上取图通道（配图搬进 uploads/）
        saveToNote:
            postActions === undefined
                ? undefined
                : (post: WeiboPagePostPayload): Promise<WeiboNoteSaveResult> =>
                      postActions.saveToNote(post, proxy === null ? undefined : createWeiboImageSaver(proxy)),
        addToChat: postActions?.addToChat,
        commentAddToChat: postActions?.commentAddToChat,
        repostAddToChat: postActions?.repostAddToChat,
        // 发布前把本地图片传图床：路径限定在 uploads 下，格式按魔数判定，体积沿用上传页的单件上限
        readUploadImage: async (relativePath: string): Promise<WeiboUploadImage> => {
            if (!isUploadPath(relativePath)) {
                throw new Error('图片路径不在 uploads 目录下')
            }
            const uri = buildStorageUri(resolveStorageRoot(), relativePath.split('/'))
            const bytes = await vscode.workspace.fs.readFile(uri)
            const mimeType = sniffImageMime(bytes)
            if (mimeType === null) {
                throw new Error('只支持 png / jpg / webp / gif 图片')
            }
            if (bytes.byteLength > MAX_UPLOAD_BYTES) {
                throw new Error(`单张图片不能超过 ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
            }
            return { bytes, mimeType }
        },
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
        void handlePanelMessage(panel, routes, upload, enhancePrompt, message)
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
