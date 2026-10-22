/**
 * AI 命令注册：面板跳转、通道凭证管理（DeepSeek 密钥 / CodeBuddy 登录）与「添加到宅对话」上下文入口。
 * 设计源：docs/modules/ai-chat.md 第 7.1 节命令清单。
 * 复用约定：引用生成与预算校验统一委托 modules/ai/contextRefs，面板跳转携带的模块意图交由 WorkflowRouter 承接。
 * 约束：全部 Disposable 挂载到 context.subscriptions，保证停用后释放（AC-10）；密钥与引用原文不落日志。
 */
import { unstable_v2_authenticate } from '@tencent-ai/agent-sdk'
import * as vscode from 'vscode'
import { createContextRefs, MAX_CONTEXT_COUNT } from './contextRefs'
import { buildCodebuddyEnv, CODEBUDDY_SITE_LABELS, toAuthEnvironment } from './providers/codebuddySite'
import type { AiChatService } from './chatService'
import type { WorkflowRouter } from './workflowRouter'
import type { SecretsService } from '../common/secrets'
import { isOpenWorkflowRequest } from '../../shared/types/workflow'
import { getZhaiConfig } from '../common/config'
import { logger } from '../common/logger'

export function registerAiCommands(
    context: vscode.ExtensionContext,
    service: AiChatService,
    secrets: SecretsService,
    router: WorkflowRouter,
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

    register('zhai.ai.addToChat', () => addEditorContextToChat(service))

    register('zhai.ai.setApiKey', async () => {
        const value = await vscode.window.showInputBox({
            title: 'DeepSeek API Key',
            prompt: '密钥仅保存在系统密钥库（SecretStorage），不写入配置文件',
            placeHolder: 'sk-...',
            password: true,
            ignoreFocusOut: true,
        })
        if (typeof value !== 'string' || value.trim().length === 0) {
            return
        }
        await secrets.set('deepseekApiKey', value.trim())
        logger.info('DeepSeek API Key 已更新')
        service.notifyRuntimeChanged()
        void vscode.window.showInformationMessage('宅写作：DeepSeek API Key 已保存')
    })

    register('zhai.ai.clearApiKey', async () => {
        const picked = await vscode.window.showWarningMessage(
            '确认清除已保存的 DeepSeek API Key？',
            { modal: true },
            '清除',
        )
        if (picked !== '清除') {
            return
        }
        await secrets.remove('deepseekApiKey')
        logger.info('DeepSeek API Key 已清除')
        service.notifyRuntimeChanged()
        void vscode.window.showInformationMessage('宅写作：已清除 DeepSeek API Key')
    })

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
                    const result = await unstable_v2_authenticate({
                        environment: toAuthEnvironment(site),
                        env: buildCodebuddyEnv(site),
                        onAuthUrl: async (state) => {
                            await vscode.env.openExternal(vscode.Uri.parse(state.authUrl))
                        },
                    })
                    logger.info(`CodeBuddy 已登录（${site}）：${result.userinfo.userName}`)
                    service.notifyRuntimeChanged()
                    void vscode.window.showInformationMessage(
                        `宅写作：CodeBuddy 已登录（${CODEBUDDY_SITE_LABELS[site]} / ${result.userinfo.userName}）`,
                    )
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    logger.error(`CodeBuddy 登录失败：${message}`, error)
                    void vscode.window.showErrorMessage(`宅写作：CodeBuddy 登录失败，${message}`)
                }
            },
        )
    })

    register('zhai.image.setApiKey', async () => {
        const value = await vscode.window.showInputBox({
            title: '图像服务 API Key',
            prompt: '用于生成角色设定图，与 DeepSeek 密钥相互独立；仅保存在系统密钥库',
            placeHolder: 'sk-...',
            password: true,
            ignoreFocusOut: true,
        })
        if (typeof value !== 'string' || value.trim().length === 0) {
            return
        }
        await secrets.set('imageApiKey', value.trim())
        logger.info('图像服务 API Key 已更新')
        void vscode.window.showInformationMessage('宅写作：图像服务 API Key 已保存')
    })

    register('zhai.image.clearApiKey', async () => {
        const picked = await vscode.window.showWarningMessage(
            '确认清除已保存的图像服务 API Key？清除后角色卡生成将不可用。',
            { modal: true },
            '清除',
        )
        if (picked !== '清除') {
            return
        }
        await secrets.remove('imageApiKey')
        logger.info('图像服务 API Key 已清除')
        void vscode.window.showInformationMessage('宅写作：已清除图像服务 API Key')
    })
}

/**
 * 「添加到宅对话」：把编辑器选区（无选区则整篇）作为上下文加入 AI 对话。
 * 引用原文不在此刻读取（发送时才取最新内容），此处只做生成、去重与用户提示。
 */
async function addEditorContextToChat(service: AiChatService): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        void vscode.window.showWarningMessage('宅写作：请先在编辑器中打开需要引用的文件')
        return
    }
    const { refs, rejected } = createContextRefs(editor)
    if (rejected.length > 0) {
        void vscode.window.showWarningMessage(`宅写作：${rejected.join('；')}`)
        return
    }
    const result = service.addContexts(refs)
    if (result.added.length === 0) {
        const reason =
            result.duplicated > 0
                ? '该内容已在对话上下文中'
                : `上下文已达 ${MAX_CONTEXT_COUNT} 项上限，请先在面板中移除`
        void vscode.window.showInformationMessage(`宅写作：${reason}`)
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
    await notifyContextAdded(labels, suffix)
}

/** 添加成功的提示：默认聚焦面板（用户能立刻看到上下文清单）并给状态栏短提示，关闭聚焦时改用信息提示 */
async function notifyContextAdded(labels: string, suffix: string): Promise<void> {
    if (!getZhaiConfig().aiAutoFocusOnContext) {
        void vscode.window.showInformationMessage(`宅写作：已添加到宅对话 ${labels}${suffix}`)
        return
    }
    await vscode.commands.executeCommand('zhai.workflow.focus')
    vscode.window.setStatusBarMessage(`宅写作：已添加到宅对话 ${labels}${suffix}`, 2000)
}
