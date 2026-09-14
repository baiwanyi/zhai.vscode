/**
 * AI 命令注册：面板跳转、DeepSeek 密钥管理与「添加到宅对话」上下文入口（ai-chat.md 第 7.1 节命令清单）。
 * 复用约定：引用生成与预算校验统一委托 modules/ai/contextRefs，命令层只做编辑器取用与用户提示。
 * 约束：全部 Disposable 挂载到 context.subscriptions，保证停用后释放（AC-10）；密钥与引用原文不落日志。
 */
import * as vscode from 'vscode'
import { createContextRefs, MAX_CONTEXT_COUNT } from './contextRefs'
import type { AiChatService } from './chatService'
import type { SecretsService } from '../common/secrets'
import { getZhaiConfig } from '../common/config'
import { logger } from '../common/logger'

export function registerAiCommands(
    context: vscode.ExtensionContext,
    service: AiChatService,
    secrets: SecretsService,
): void {
    const register = (command: string, handler: () => unknown): void => {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler))
    }

    register('zhai.openAiChat', () => {
        void vscode.commands.executeCommand('zhai.aiChat.focus')
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
        void vscode.window.showInformationMessage('Zhai：DeepSeek API Key 已保存')
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
        void vscode.window.showInformationMessage('Zhai：已清除 DeepSeek API Key')
    })
}

/**
 * 「添加到宅对话」：把编辑器选区（无选区则整篇）作为上下文加入 AI 对话。
 * 引用原文不在此刻读取（发送时才取最新内容），此处只做生成、去重与用户提示。
 */
async function addEditorContextToChat(service: AiChatService): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        void vscode.window.showWarningMessage('Zhai：请先在编辑器中打开需要引用的文件')
        return
    }
    const { refs, rejected } = createContextRefs(editor)
    if (rejected.length > 0) {
        void vscode.window.showWarningMessage(`Zhai：${rejected.join('；')}`)
        return
    }
    const result = service.addContexts(refs)
    if (result.added.length === 0) {
        const reason =
            result.duplicated > 0
                ? '该内容已在对话上下文中'
                : `上下文已达 ${MAX_CONTEXT_COUNT} 项上限，请先在面板中移除`
        void vscode.window.showInformationMessage(`Zhai：${reason}`)
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
        void vscode.window.showInformationMessage(`Zhai：已添加到宅对话 ${labels}${suffix}`)
        return
    }
    await vscode.commands.executeCommand('zhai.aiChat.focus')
    vscode.window.setStatusBarMessage(`Zhai：已添加到宅对话 ${labels}${suffix}`, 2000)
}
