/**
 * AI 命令注册：面板跳转、CodeBuddy 登录与登出、以及「添加到宅对话」上下文入口。
 * 设计源：docs/modules/ai-chat.md 第 7.1 节命令清单。
 * 复用约定：引用生成与预算校验统一委托 modules/ai/contextRefs；面板跳转走 WorkflowRouter——
 * 模块选定决定显示哪个工作流页，页内视图请求（requestView）决定页内停在哪个分区；
 * 失败提示统一经 notify 走 Webview 的 sonner，无视图可显示时回退 VS Code 原生提示；
 * 编辑器块菜单的「添加到 AI 对话」直接调 addQuoteToChat，与命令共用同一套引用生成与去向。
 * 约束：全部 Disposable 挂载到 context.subscriptions，保证停用后释放（AC-10）；密钥与引用原文不落日志。
 * 模型选择不在命令面板，改由 AI 面板输入区的模型菜单（ai/models / ai/selectModel）承接。
 */
import * as vscode from 'vscode'
import { getZhaiConfig } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import type { ToastService } from '@modules/common/toastService'
import { getActiveDocument, readRichSelection } from '@modules/editor/activeDocument'
import type { EditorChatContextResult } from '@shared/types/editor'
import { isOpenWorkflowRequest, NOTES_MODULE_KEY, WECHAT_MODULE_KEY } from '@shared/types/workflow'
import type { WorkflowContextState } from '@shared/types/workflow'
import {
    createContextRefs,
    createDocumentContextRef,
    createOffsetContextRef,
    createQuoteContextRef,
    MAX_CONTEXT_COUNT,
} from './contextRefs'
import { clearCodebuddyLogin, rememberCodebuddyLogin } from './providers/codebuddyLogin'
import {
    buildCodebuddyEnv,
    CODEBUDDY_SITE_LABELS,
    isSiteAuthUrl,
    toAuthEnvironment,
    toAuthMethodId,
} from './providers/codebuddySite'
import type { AiChatService } from './chatService'
import type { ContextRefResult } from './contextRefs'
import type { WorkflowRouter } from './workflowRouter'

export function registerAiCommands(
    context: vscode.ExtensionContext,
    service: AiChatService,
    router: WorkflowRouter,
    toast: ToastService,
): void {
    const register = (command: string, handler: (...args: unknown[]) => unknown): void => {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler))
    }

    // 命令面板调用（无参）只聚焦面板；仪表盘入口跳转携带模块意图，由路由服务按模块类型决定展示页面
    register('zhai.openAiChat', (request?: unknown) => {
        if (isOpenWorkflowRequest(request)) {
            router.selectModule(request.module)
        }
        void vscode.commands.executeCommand('zhai.workflow.focus')
    })

    /**
     * 只选定模块、不聚焦面板：仪表盘进入公众号页时调用，让工作流侧栏出现公众号六分区。
     * 关键约束：不能复用 zhai.openAiChat——那条命令会 focus 面板，导致用户点开公众号页时被抢走焦点。
     */
    register('zhai.workflow.selectModule', (module?: unknown) => {
        if (typeof module === 'string' && module.length > 0) {
            router.selectModule(module)
        }
    })

    register('zhai.ai.addToChat', () => addEditorContextToChat(service, toast, router))

    // CodeBuddy 通道：SDK 自带 CLI，用户只需完成一次浏览器登录，凭证由 CLI 按站点分别缓存。
    // 命令面板标题在 package.json 的 category + title 中定义，错误提示引导用户时按同一标题表述，
    // 改标题须同步 providers/codebuddyError 的 auth 文案
    register('zhai.ai.loginCodebuddy', async () => {
        const site = getZhaiConfig().aiCodebuddySite
        // SDK 首次加载约 350ms：登录本就要起子进程，加载放在命令内，不占激活耗时
        const sdk = await import('@tencent-ai/agent-sdk')
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `CodeBuddy 登录（${CODEBUDDY_SITE_LABELS[site]}）`,
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: '正在打开浏览器授权页…' })
                try {
                    // 站点同时决定认证环境、登录方式与授权页域名：三站点授权页分属不同域名，错配会在错误站点完成授权
                    const result = await sdk.unstable_v2_authenticate({
                        environment: toAuthEnvironment(site),
                        methodId: toAuthMethodId(site),
                        env: buildCodebuddyEnv(site),
                        onAuthUrl: async (state) => {
                            if (!isSiteAuthUrl(site, state.authUrl)) {
                                logger.warn(
                                    `CodeBuddy 授权页域名与所选站点不符（${CODEBUDDY_SITE_LABELS[site]}）：${state.authUrl}`,
                                )
                                toast.notifyOrShow(
                                    'warning',
                                    `宅写作：授权页不是${CODEBUDDY_SITE_LABELS[site]}的域名（${state.authUrl}），请检查「宅写作：CodeBuddy 站点」设置`,
                                )
                            }
                            await vscode.env.openExternal(vscode.Uri.parse(state.authUrl))
                        },
                    })
                    logger.info(`CodeBuddy 已登录（${site}）：${result.userinfo.userName}`)
                    // 记住站点登录态：面板据此收起登录引导，重启窗口后仍然有效
                    rememberCodebuddyLogin(site, result.userinfo.userName)
                    service.notifyRuntimeChanged()
                    toast.notifyOrShow(
                        'success',
                        `宅写作：CodeBuddy 已登录（${CODEBUDDY_SITE_LABELS[site]} / ${result.userinfo.userName}）`,
                    )
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    logger.error(`CodeBuddy 登录失败：${message}`, error)
                    toast.notifyOrShow('error', `宅写作：CodeBuddy 登录失败，${message}`)
                }
            },
        )
    })

    // 登出：先清 CLI 侧该站点的缓存凭证，再清插件记录的登录态，两者成对执行
    register('zhai.ai.logoutCodebuddy', async () => {
        const site = getZhaiConfig().aiCodebuddySite
        try {
            const sdk = await import('@tencent-ai/agent-sdk')
            await sdk.unstable_v2_logout({ environment: toAuthEnvironment(site), env: buildCodebuddyEnv(site) })
            clearCodebuddyLogin(site)
            service.notifyRuntimeChanged()
            logger.info(`CodeBuddy 已登出（${site}）`)
            toast.notifyOrShow('success', `宅写作：已退出 CodeBuddy 登录（${CODEBUDDY_SITE_LABELS[site]}）`)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.error(`CodeBuddy 登出失败：${message}`, error)
            toast.notifyOrShow('error', `宅写作：CodeBuddy 登出失败，${message}`)
        }
    })

    // 模型选择由 AI 面板输入区的模型菜单承接（ai/models + ai/selectModel），此处不再注册命令
}

/**
 * 「添加到宅对话」：把编辑器选区（无选区则整篇）作为上下文加入 AI 对话。
 * 引用原文不在此刻读取（发送时才取最新内容），此处只做生成、去重与去向跳转。
 * 关键约束：成功不弹提示——面板里的上下文芯片就是回执；失败与拒绝仍要提示，否则用户不知道为何没加上。
 */
async function addEditorContextToChat(
    service: AiChatService,
    toast: ToastService,
    router: WorkflowRouter,
): Promise<void> {
    const editor = vscode.window.activeTextEditor
    const active = getActiveDocument()
    let contextResult: ContextRefResult
    if (editor !== undefined) {
        contextResult = createContextRefs(editor)
    } else if (active !== null) {
        // 富文本 tab 没有 TextEditor：优先用上报的选区，定位不到再降级为整篇
        const document = await vscode.workspace.openTextDocument(active.uri)
        const snapshot = readRichSelection(active.uri)
        const quoteRef =
            snapshot !== null && snapshot.quote !== '' ? createQuoteContextRef(document, snapshot.quote) : null
        contextResult = quoteRef === null ? createDocumentContextRef(document) : { refs: [quoteRef], rejected: [] }
    } else {
        toast.notifyOrShow('warning', '宅写作：请先在编辑器中打开需要引用的文件')
        return
    }
    const { refs, rejected } = contextResult
    if (rejected.length > 0) {
        toast.notifyOrShow('warning', `宅写作：${rejected.join('；')}`)
        return
    }
    // 引用必须落到当前文档所属的会话上：面板未打开时也要先对齐作用域，否则会加进通用对话
    service.useScope(readDocumentScope(router))
    const result = service.addContexts(refs)
    if (result.added.length === 0) {
        const reason =
            result.duplicated > 0
                ? '该内容已在对话上下文中'
                : `上下文已达 ${MAX_CONTEXT_COUNT} 项上限，请先在面板中移除`
        toast.notifyOrShow('info', `宅写作：${reason}`)
        return
    }
    const labels = result.added.map((ref) => ref.label).join('、')
    const extras: string[] = []
    if (result.duplicated > 0) {
        extras.push(`${result.duplicated} 项重复已忽略`)
    }
    if (result.isFull) {
        extras.push(`已达 ${MAX_CONTEXT_COUNT} 项上限`)
    }
    const suffix = extras.length > 0 ? `（${extras.join('，')}）` : ''
    logger.info(`已添加上下文引用：${labels}${suffix}`)
    await focusChatSection(router)
}

/**
 * 把一段引用文本加入宅对话上下文：编辑器块菜单「添加到 AI 对话」的宿主侧实现。
 * 行范围优先按块在原文中的字符区间换算，偏移过期（快照重建前）才退回按文本搜索——
 * 文本搜索对重复段落会定位到第一次出现，行号就不对；块偏移不会。
 * 成功后的去向与命令一致：切到写作管理模块的对话分区并聚焦面板。
 */
export async function addQuoteToChat(
    service: AiChatService,
    router: WorkflowRouter,
    document: vscode.TextDocument,
    quote: string,
    /** 块在 Markdown 原文中的字符区间：由编辑器快照的块偏移给出，缺省表示按文本定位 */
    blockRange: { start: number; end: number } | null = null,
): Promise<EditorChatContextResult> {
    const byOffset = blockRange === null ? null : createOffsetContextRef(document, blockRange.start, blockRange.end)
    const ref = byOffset ?? createQuoteContextRef(document, quote)
    if (ref === null) {
        return { added: false, reason: '未能在文档中定位这段内容，可能已被修改' }
    }
    // 与命令同一口径：先把会话作用域对齐到当前文档，笔记之间才不会互相串对话
    service.useScope(readDocumentScope(router))
    const result = service.addContexts([ref])
    if (result.added.length === 0) {
        return {
            added: false,
            reason:
                result.duplicated > 0
                    ? '这段内容已在对话上下文中'
                    : `上下文已达 ${MAX_CONTEXT_COUNT} 项上限，请先在对话面板中移除`,
        }
    }
    await focusChatSection(router)
    return { added: true, label: ref.label }
}

/**
 * 添加成功后的去向：无论当前停在哪个页面，都切到写作管理模块的对话分区并聚焦面板。
 * 关键约束：模块选定与页内视图是两件事——前者决定显示哪个工作流页，后者决定页内停在哪个分区；
 * 已在该模块时模块选定不会产生新事实，必须靠视图请求才能从设定、大纲等分区切回对话。
 * 微博卡片的「添加到 AI 对话」复用本函数，保证两条入口的去向与提示口径一致。
 */
export async function focusChatSection(router: WorkflowRouter): Promise<void> {
    router.selectModule(PRESS_MODULE_DIR)
    router.requestView('chat')
    await vscode.commands.executeCommand('zhai.workflow.focus')
}

/** 文档是否属于当前归属：作品看作品目录前缀，笔记 / 公众号看模块目录前缀 */
function isDocumentInScope(context: WorkflowContextState, docPath: string): boolean {
    if (context.module === NOTES_MODULE_KEY) {
        return docPath.startsWith(`${NOTES_MODULE_KEY}/`)
    }
    if (context.module === WECHAT_MODULE_KEY) {
        return docPath.startsWith(`${WECHAT_MODULE_KEY}/`)
    }
    return context.projectDir !== null && docPath.startsWith(`${context.projectDir}/`)
}

/**
 * 当前文档的会话作用域：与前端 contentScope 的 readScopeDir 同口径——
 * 每个文档各自一份对话，文档属于当前归属时取文档相对路径；
 * 否则回落到旧口径（笔记取模块目录、公众号取模块键、作品取目录）。
 */
function readDocumentScope(router: WorkflowRouter): string | null {
    const context = router.getContext()
    const docPath = context.docPath
    if (docPath !== null && isDocumentInScope(context, docPath)) {
        return docPath
    }
    if (context.module === NOTES_MODULE_KEY) {
        return context.module
    }
    if (context.module === WECHAT_MODULE_KEY || context.selectedModule === WECHAT_MODULE_KEY) {
        return WECHAT_MODULE_KEY
    }
    return context.projectDir
}
