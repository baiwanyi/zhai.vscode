/**
 * AI 命令注册：面板跳转、CodeBuddy 登录与模型选择、以及「添加到宅对话」上下文入口。
 * 设计源：docs/modules/ai-chat.md 第 7.1 节命令清单。
 * 复用约定：引用生成与预算校验统一委托 modules/ai/contextRefs，面板跳转携带的模块意图交由 WorkflowRouter 承接。
 * 约束：全部 Disposable 挂载到 context.subscriptions，保证停用后释放（AC-10）；密钥与引用原文不落日志。
 */
import { unstable_v2_authenticate } from '@tencent-ai/agent-sdk'
import * as vscode from 'vscode'
import { createContextRefs, MAX_CONTEXT_COUNT } from './contextRefs'
import { listCodebuddyModels } from './providers/codebuddyModels'
import {
    buildCodebuddyEnv,
    CODEBUDDY_SITE_LABELS,
    isSiteAuthUrl,
    toAuthEnvironment,
    toAuthMethodId,
} from './providers/codebuddySite'
import type { AiChatService } from './chatService'
import type { WorkflowRouter } from './workflowRouter'
import type { SecretsService } from '../common/secrets'
import { isOpenWorkflowRequest } from '../../shared/types/workflow'
import { getZhaiConfig } from '../common/config'
import { logger } from '../common/logger'

/** 模型选择列表里「手动输入」项的哨兵值，避免与真实模型 id 冲突 */
const CUSTOM_MODEL_MARK = '__zhai_custom_model__'

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
                                void vscode.window.showWarningMessage(
                                    `宅写作：授权页不是${CODEBUDDY_SITE_LABELS[site]}的域名（${state.authUrl}），请检查「宅写作：CodeBuddy 站点」设置`,
                                )
                            }
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

    // 模型选择：清单在激活时预热过，这里强制刷新一次，保证换站点/换账号后拿到最新列表
    register('zhai.ai.selectCodebuddyModel', async () => {
        const targets = [
            {
                label: '对话模型',
                description: 'zhai.ai.codebuddyModel：面板对话、取名、人物外貌生成',
                key: 'ai.codebuddyModel',
            },
            {
                label: '出图驱动模型',
                description: 'zhai.image.codebuddyModel：驱动 ImageGen 调用的对话模型',
                key: 'image.codebuddyModel',
            },
        ]
        const target = await vscode.window.showQuickPick(targets, { title: '选择要设置的 CodeBuddy 模型用途' })
        if (target === undefined) {
            return
        }
        const models = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '正在获取 CodeBuddy 可用模型…',
                cancellable: false,
            },
            () => listCodebuddyModels(secrets, true),
        )
        if (models.length === 0) {
            void vscode.window.showWarningMessage(
                '宅写作：未取到 CodeBuddy 可用模型，请先执行「宅写作：登录 CodeBuddy」',
            )
            return
        }
        const options = [
            { label: '使用默认模型', description: '清空该配置，由 CLI 自行决定', modelId: '' },
            ...models.map((model) => ({ label: model.name, description: model.modelId, modelId: model.modelId })),
            {
                label: '手动输入模型 id…',
                description: '账号可用但不在上表中的模型，直接填写 id',
                modelId: CUSTOM_MODEL_MARK,
            },
        ]
        const picked = await vscode.window.showQuickPick(options, {
            title: `选择${target.label}`,
            placeHolder: '列表来自当前账号，也可手动填写自定义模型 id',
        })
        if (picked === undefined) {
            return
        }
        let modelId = picked.modelId
        if (modelId === CUSTOM_MODEL_MARK) {
            const manual = await vscode.window.showInputBox({
                title: `输入${target.label} id`,
                prompt: '填写 CodeBuddy 账号可用的模型 id，留空表示交给 CLI 默认',
                placeHolder: '例如 deepseek-v4.1-flash',
                ignoreFocusOut: true,
            })
            if (manual === undefined) {
                return
            }
            modelId = manual.trim()
        }
        await vscode.workspace.getConfiguration('zhai').update(target.key, modelId, vscode.ConfigurationTarget.Global)
        logger.info(`CodeBuddy ${target.label}已设为 ${modelId.length > 0 ? modelId : '默认'}`)
        void vscode.window.showInformationMessage(
            `宅写作：${target.label}已设为 ${modelId.length > 0 ? modelId : '默认模型'}`,
        )
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
