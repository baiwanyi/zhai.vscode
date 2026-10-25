/**
 * AI 命令注册：面板跳转、CodeBuddy 登录、以及「添加到宅对话」上下文入口。
 * 设计源：docs/modules/ai-chat.md 第 7.1 节命令清单。
 * 复用约定：引用生成与预算校验统一委托 modules/ai/contextRefs，面板跳转携带的模块意图交由 WorkflowRouter 承接；
 * 操作反馈统一经 notify 走 Webview 的 sonner，无视图可显示时回退 VS Code 原生提示。
 * 约束：全部 Disposable 挂载到 context.subscriptions，保证停用后释放（AC-10）；密钥与引用原文不落日志。
 * 模型选择不在命令面板，改由 AI 面板输入区的模型菜单（ai/models / ai/selectModel）承接。
 */
import { unstable_v2_authenticate } from '@tencent-ai/agent-sdk'
import * as vscode from 'vscode'
import { getZhaiConfig } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { ToastService } from '@modules/common/toastService'
import { isOpenWorkflowRequest } from '@shared/types/workflow'
import { createContextRefs, MAX_CONTEXT_COUNT } from './contextRefs'
import { rememberCodebuddyLogin } from './providers/codebuddyLogin'
import {
    buildCodebuddyEnv,
    CODEBUDDY_SITE_LABELS,
    isSiteAuthUrl,
    toAuthEnvironment,
    toAuthMethodId,
} from './providers/codebuddySite'
import type { AiChatService } from './chatService'
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

    register('zhai.ai.addToChat', () => addEditorContextToChat(service, toast))

    // CodeBuddy 通道：SDK 自带 CLI，用户只需完成一次浏览器登录，凭证由 CLI 按站点分别缓存
    register('zhai.ai.loginCodebuddy', async () => {
        const site = getZhaiConfig().aiCodebuddySite
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
                    const result = await unstable_v2_authenticate({
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

    // 模型选择由 AI 面板输入区的模型菜单承接（ai/models + ai/selectModel），此处不再注册命令
}

/**
 * 「添加到宅对话」：把编辑器选区（无选区则整篇）作为上下文加入 AI 对话。
 * 引用原文不在此刻读取（发送时才取最新内容），此处只做生成、去重与用户提示。
 */
async function addEditorContextToChat(service: AiChatService, toast: ToastService): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        toast.notifyOrShow('warning', '宅写作：请先在编辑器中打开需要引用的文件')
        return
    }
    const { refs, rejected } = createContextRefs(editor)
    if (rejected.length > 0) {
        toast.notifyOrShow('warning', `宅写作：${rejected.join('；')}`)
        return
    }
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
    logger.info(`已添加上下文引用：${labels}`)
    await notifyContextAdded(toast, labels, suffix)
}

/**
 * 添加成功的反馈：统一经 sonner 提示；配置开启自动聚焦时再切到面板，
 * 让用户立刻看到上下文清单（提示本身不再依赖面板是否已打开）。
 */
async function notifyContextAdded(toast: ToastService, labels: string, suffix: string): Promise<void> {
    toast.notifyOrShow('success', `宅写作：已添加到宅对话 ${labels}${suffix}`)
    if (getZhaiConfig().aiAutoFocusOnContext) {
        await vscode.commands.executeCommand('zhai.workflow.focus')
    }
}
