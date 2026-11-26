/**
 * 微博面板（编辑区）：在编辑器区域打开独立 webview 页，承载关注时间线与 Cookie 配置。
 * 复用约定：HTML 与 CSP 注入走 common/webviewHtml，与仪表盘、富文本编辑器共用同一份构建产物加载逻辑；
 * 消息协议复用 shared/types/messages 的 request/response 形状，方法名受 HostMethodName 约束；
 * 面板标识取 shared/types/workflow，工作流路由用它把「活跃标签是微博」映射为微博语境。
 * 关键约束：Cookie 存在 SecretStorage，本层只把 WeiboCookieStore 交给路由，明文不出宿主；
 * 图床按 Referer 放行，图片经 mediaProxy 落本地后签发 asWebviewUri 交给 Webview（零 IPC 传输、按需加载），
 * 回退通道（IMAGE_TRANSPORT）才内联 data URI，超过 1.5MB 时改取 bmiddle 缩略图；
 * 图片缓存目录须列入 localResourceRoots，否则 asWebviewUri 地址会被拒绝；
 * 视频不落缓存：CSP 的 media-src 放行微博视频 CDN，由 Webview 直接播整段 mp4，面板无需授权任何缓存目录；
 * 发表框按白名单转交 upload/pick|bytes|list、media/list（生图栏）与 stock/downloaded（在线图库栏），
 * 三套路由与工作流面板共用同一份实例，ai/enhancePrompt 转交 AI 服务；
 * 其余方法（含媒体与图库的写操作、编辑器 insert/remove/reveal）不对微博页面开放，避免注入脚本借面板改动媒体库；
 * 错误文案回传前剥成单行纯文本并截断，微博路由本身不认这些前缀；
 * 发布前由本层读出 uploads 图片字节（限定路径、按魔数判格式），传图床与提交正文都在 webPublish 内完成；
 * 存储根须列入 localResourceRoots，否则 uploads 缩略图的 asWebviewUri 地址会被拒绝；
 * 面板激活、失焦与销毁都要经 activeDocument 上报/让位，关闭时同时清理事实与句柄。
 */
import * as vscode from 'vscode'
import { getZhaiConfig, resolveStorageRoot } from '@modules/common/config'
import { sniffImageMime } from '@modules/common/imageSniff'
import { logger } from '@modules/common/logger'
import { buildStorageUri } from '@modules/common/storagePath'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import { getActivePanel, reportActivePanel } from '@modules/editor/activeDocument'
import type { MediaRoutes } from '@modules/media/mediaRoutes'
import type { StockRoutes } from '@modules/stock/stockRoutes'
import { MAX_UPLOAD_BYTES } from '@modules/upload/uploadPayload'
import type { UploadRoutes } from '@modules/upload/uploadRoutes'
import { isRequestMessage } from '@shared/types/messages'
import { isUploadPath } from '@shared/types/upload'
import type { WeiboNoteSaveResult, WeiboPagePostPayload } from '@shared/types/weibo'
import { WEIBO_PANEL_VIEW_TYPE } from '@shared/types/workflow'
import { MEDIA_CACHE_DIR_NAME, createWeiboMediaResolver } from './config'
import type { WeiboUploadImage } from '../api/write/publish'
import type { WeiboRoutes } from '../protocol/routes'
import type { WeiboPostActions } from './postActions'
import { createWeiboAvatarGateway } from '../media/avatar'
import { IMAGE_TRANSPORT, createWeiboImageSaver, readInlineImage } from '../media/intake'
import { createWeiboVideoServer } from '../media/videoServer'
import { WeiboRoutes as WeiboRoutesImpl } from '../protocol/routes'
import { EMPTY_COOKIE_STORE, createWeiboCookieStore } from '../store/credential'
import { createWeiboCache } from '../store/metadataCache'
import { stripWeiboHtml } from '../timeline/text'
import { WeiboWebError } from '../transport/httpClient'

/**
 * 微博面板允许转交的上传方法：发表框只需要选图、上传字节与列表三类。
 * 关键约束：insert / remove / reveal 属编辑器语境，微博页面用不到；不开比开更安全，
 * 否则一个被注入的 Webview 脚本就能借面板删掉 uploads 下的任意文件。
 */
const WEIBO_UPLOAD_METHODS: ReadonlySet<string> = new Set(['upload/pick', 'upload/bytes', 'upload/list'])

/**
 * 发表框图片浏览栏转交的只读方法：生图栏列举媒体库，在线图库栏列举已下载图片。
 * 关键约束：只放行这两个列举方法，媒体与图库的删除、插入、下载及密钥管理一律不向微博页面开放，
 * 否则被注入的 Webview 脚本可借面板写权限改动用户的媒体库与图库配置。
 */
const WEIBO_MEDIA_METHODS: ReadonlySet<string> = new Set(['media/list'])
const WEIBO_STOCK_METHODS: ReadonlySet<string> = new Set(['stock/downloaded'])

/** 错误文案上限：上游 msg 可能很长，回传前截断避免把整段响应带进提示 */
const MAX_ERROR_MESSAGE_LENGTH = 200

/**
 * 错误文案清洗：上游 msg 与底层异常都可能夹带 HTML，回传 Webview 前剥成单行纯文本。
 * 关键约束：不改动错误分类码，只处理文案——前端按 code 分发，按 message 展示。
 */
function toSafeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error)
    const text = stripWeiboHtml(raw).replace(/\s+/gu, ' ').trim()
    return text.length > MAX_ERROR_MESSAGE_LENGTH ? `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : text
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
    media: MediaRoutes | undefined,
    stock: StockRoutes | undefined,
    enhancePrompt: WeiboEnhancePrompt | undefined,
    message: unknown,
): Promise<void> {
    if (!isRequestMessage(message)) {
        return
    }
    const { reqId, method, payload } = message
    try {
        // 三类图片来源与工作流面板共用同一份路由：发表框生图栏读媒体库、在线图库栏读已下载图片、
        // 图片选择与粘贴上传要读 uploads 清单并写字节流；ai/enhancePrompt 则转交 AI 服务。
        // 任一路由未注入时都落到兜底分支并回报「未登记」，不静默返回空结果。
        const toWebviewUri = (uri: vscode.Uri): string => panel.webview.asWebviewUri(uri).toString()
        let result: unknown
        if (WEIBO_UPLOAD_METHODS.has(method) && upload !== undefined) {
            result = await upload.handle(method, payload, toWebviewUri)
        } else if (WEIBO_MEDIA_METHODS.has(method) && media !== undefined) {
            result = await media.handle(method, payload, toWebviewUri)
        } else if (WEIBO_STOCK_METHODS.has(method) && stock !== undefined) {
            result = await stock.handle(method, payload, toWebviewUri)
        } else if (method === 'ai/enhancePrompt' && enhancePrompt !== undefined) {
            result = await enhancePrompt(payload)
        } else {
            result = await routes.handle(method, payload)
        }
        await panel.webview.postMessage({ type: 'response', reqId, ok: true, payload: result })
    } catch (error) {
        const text = toSafeErrorMessage(error)
        const code = error instanceof WeiboWebError ? error.code : method
        // 只记文案与堆栈：错误对象上可能挂着请求载荷，整体打进日志等于把用户内容抄一份到输出通道
        logger.error(
            `微博面板请求处理失败：${method}`,
            error instanceof Error ? (error.stack ?? error.message) : String(error),
        )
        await panel.webview.postMessage({ type: 'response', reqId, ok: false, error: { code, message: text } })
    }
}

/**
 * 打开微博面板：已存在则聚焦，否则在编辑区新开一页。
 * secrets 缺省时凭证读写退化为空实现；mediaCacheRoot 缺省时不代理图片（卡片显示占位）；
 * postActions 缺省时卡片的「保存到笔记」「添加到 AI 对话」按未就绪回包，其余功能不受影响；
 * upload 缺省时发表框的图片选择与粘贴上传报未就绪，其余功能照常；
 * media / stock 缺省时发表框的生图与在线图库两栏为空，其余功能照常；
 * enhancePrompt 缺省时发表框的「AI 优化」报未登记，其余功能照常。
 */
export async function openWeiboPanel(
    extensionUri: vscode.Uri,
    secrets?: vscode.SecretStorage,
    mediaCacheRoot?: vscode.Uri,
    postActions?: WeiboPostActions,
    upload?: UploadRoutes,
    enhancePrompt?: WeiboEnhancePrompt,
    media?: MediaRoutes,
    stock?: StockRoutes,
): Promise<void> {
    if (current !== null) {
        current.reveal()
        return
    }
    const webviewDist = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
    // 资源白名单：构建产物 + 存储根（发表框缩略图）+ 图片缓存目录（卡片图走 asWebviewUri）
    const mediaCacheDir =
        mediaCacheRoot === undefined ? null : vscode.Uri.joinPath(mediaCacheRoot, MEDIA_CACHE_DIR_NAME)
    if (mediaCacheDir !== null) {
        // 目录必须先存在：localResourceRoots 指向一个尚不存在的目录时，asWebviewUri 签发的地址会全部被拒。
        // 首次打开面板时缓存目录还没被创建（它由第一次下载图片时按需 mkdir），这里先建出来。
        try {
            await vscode.workspace.fs.createDirectory(mediaCacheDir)
        } catch (error) {
            // 建不出来也不能让面板打不开：内联通道不依赖该目录
            logger.warn(`微博图片缓存目录创建失败：${error instanceof Error ? error.message : String(error)}`)
        }
    }
    const resourceRoots = [webviewDist, resolveStorageRoot()]
    if (mediaCacheDir !== null) {
        resourceRoots.push(mediaCacheDir)
    }
    const panel = vscode.window.createWebviewPanel(WEIBO_PANEL_VIEW_TYPE, '微博', vscode.ViewColumn.Active, {
        enableScripts: true,
        // 切到其它 tab 再回来不重建页面：时间线滚动位置与已加载内容活在前端状态里，重建会直接丢掉
        retainContextWhenHidden: true,
        localResourceRoots: resourceRoots,
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
        // 清除凭证时连带清图片缓存：换号后旧账号的正文图与头像原图不应留在磁盘上
        clearMediaCache:
            proxy === null
                ? undefined
                : async (): Promise<void> => {
                      await proxy.clearCache()
                  },
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
                      if (filePath === null) {
                          return null
                      }
                      if (IMAGE_TRANSPORT === 'webview-uri') {
                          // 只签发本地缓存文件的地址：文件被清理后由前端 onError 落到占位
                          return panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString()
                      }
                      return readInlineImage(proxy, imageUrl, filePath)
                  },
        // 视频：只把 CDN 地址换成回环地址，字节流由本地服务带 Referer 转发，不落缓存
        resolveVideoUrl:
            videoServer === null
                ? undefined
                : (videoUrl: string): Promise<{ url: string; seekable: boolean } | null> =>
                      Promise.resolve(videoServer.toLocalUrl(videoUrl)),
    })

    // 监听在面板销毁时显式释放：重开面板会重建一份，不释放就叠加处理链
    const messageListener = panel.webview.onDidReceiveMessage((message: unknown) => {
        void handlePanelMessage(panel, routes, upload, media, stock, enhancePrompt, message)
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
