/**
 * 公众号层装配：把 wechat.db、密钥、Token 缓存、七个业务服务与路由收成一份依赖包。
 * 复用约定：鉴权失败统一经 createWechatAuthFailureHandler 落库，再用 EventEmitter 广播给两个面板，
 * 订阅方不必在装配完成后手工登记回调；批次服务复用索引库做导入源校验。
 * 关键约束：库必须在此刻打开——「推送中」批次回收要先于任何业务读写完成，惰性打开会让回收时机
 * 随面板打开漂移；本层创建的监听、广播器一律登记到 context.subscriptions。
 */
import * as vscode from 'vscode'
import { runWithLoggedFailure } from '@modules/common/asyncTask'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { WechatAccountService } from '@modules/wechat/accountService'
import { createWechatAuthFailureHandler, type WechatAuthFailureListener } from '@modules/wechat/authFailureHandler'
import { WechatCommentService } from '@modules/wechat/commentService'
import { createWechatSecretStore } from '@modules/wechat/credentials'
import { openWechatDatabase } from '@modules/wechat/db/connection'
import { recoverStalePushingIssues } from '@modules/wechat/db/issueRepository'
import { WechatFanService } from '@modules/wechat/fanService'
import { WechatIssueRenameService } from '@modules/wechat/issueRenameService'
import { WechatIssueService } from '@modules/wechat/issueService'
import { WechatMaterialService } from '@modules/wechat/materialService'
import { WechatMenuService } from '@modules/wechat/menuService'
import { WechatPublishService } from '@modules/wechat/publishService'
import { WechatStatsService } from '@modules/wechat/statsService'
import { WechatTokenService } from '@modules/wechat/tokenService'
import { WechatRoutes } from '@modules/wechat/wechatRoutes'
import type { WechatAccountAuthFailureEvent } from '@shared/types/wechat'
import type Database from 'better-sqlite3'

/** 群发卡在「推送中」的回收阈值：群发轮询最长约 8 秒，留足余量给慢网，超过基本可判定为宿主中途退出 */
const STALE_PUSHING_WINDOW_MS = 10 * 60 * 1000

/** 装配依赖：公众号层只依赖扩展上下文、缓存目录与索引库 */
export interface WechatLayerDeps {
    context: vscode.ExtensionContext
    cacheRoot: vscode.Uri
    /** 索引库：批次服务据此校验导入源路径确属已索引文件 */
    indexDb: Database.Database
}

/** 装配产物：路由交给面板，鉴权失效广播交给两个面板订阅 */
export interface WechatLayer {
    routes: WechatRoutes
    onAuthFailure: (listener: WechatAuthFailureListener) => vscode.Disposable
}

/** 装配公众号层：打开库、回收卡死批次、串起账号 / 批次 / 素材 / 发布与四个运营服务 */
export function assembleWechatLayer(deps: WechatLayerDeps): WechatLayer {
    const { context, cacheRoot, indexDb } = deps
    const wechatDb = openWechatDatabase(cacheRoot)
    context.subscriptions.push({ dispose: () => wechatDb.close() })
    // 群发过程中退出会把批次卡在「推送中」：超过阈值的启动时回收为失败并提示去后台确认
    const stalePushing = recoverStalePushingIssues(
        wechatDb,
        new Date(Date.now() - STALE_PUSHING_WINDOW_MS).toISOString(),
        '宿主在群发过程中退出，发布结果未知：请到公众号后台确认是否已发布',
    )
    if (stalePushing > 0) {
        logger.info(`公众号：回收 ${String(stalePushing)} 个卡在推送中的批次`)
    }
    // 密钥与 Token 缓存全模块共用一份：账号鉴权与素材上传走同一把 Token，避免各自刷新互相失效
    const secrets = createWechatSecretStore(context.secrets)
    // 鉴权失败的广播出口：面板拿到本层后订阅（账号测试、素材上传、草稿提交与群发都经过它）
    const authFailure = new vscode.EventEmitter<WechatAccountAuthFailureEvent>()
    context.subscriptions.push(authFailure)
    const tokens = new WechatTokenService({
        onAuthFailure: createWechatAuthFailureHandler({
            db: wechatDb,
            broadcast: (event): void => authFailure.fire(event),
        }),
    })
    const accounts = new WechatAccountService({
        db: wechatDb,
        secrets,
        tokens,
        state: context.globalState,
    })
    // 批次服务复用索引库做导入源校验：路径先回查 files 表，再读盘，前端无法指定任意文件
    const issues = new WechatIssueService({ db: wechatDb, indexDb })
    // 批次文章与笔记同构：保存时让 md 文件名跟随正文一级标题，同步 wechat.db 的 title 与 file_path；
    // 宿主经 workspace.fs 的写入不产生保存事件，两条通道不会互相触发
    const issueRename = new WechatIssueRenameService(wechatDb)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            runWithLoggedFailure((): Promise<void> => issueRename.handleSave(document), '公众号文章重命名处理异常')
        }),
    )
    // 素材服务按存储根解析本地图片：存储根可随配置变更，故用函数惰性取值
    const materials = new WechatMaterialService({
        db: wechatDb,
        secrets,
        tokens,
        resolveRoot: (): string => resolveStorageRoot().fsPath,
    })
    const publish = new WechatPublishService({
        db: wechatDb,
        secrets,
        tokens,
        materials,
        issues,
    })
    // 四个运营服务只依赖账号表、密钥与 Token 缓存，共用同一组依赖
    const tokenDeps = { db: wechatDb, secrets, tokens }
    // 两个面板共用同一份公众号路由：仪表盘发起账号与批次动作，工作流面板发起运营分区请求
    const routes = new WechatRoutes({
        accounts,
        issues,
        publish,
        materials,
        menu: new WechatMenuService(tokenDeps),
        fans: new WechatFanService(tokenDeps),
        stats: new WechatStatsService(tokenDeps),
        comments: new WechatCommentService(tokenDeps),
    })
    return {
        routes,
        onAuthFailure: (listener: WechatAuthFailureListener): vscode.Disposable => authFailure.event(listener),
    }
}
