/**
 * AI 命令注册：面板跳转与 DeepSeek 密钥管理（ai-chat.md 第 7.1 节命令清单的子集）。
 * 约束：全部 Disposable 挂载到 context.subscriptions，保证停用后释放（AC-10）；密钥不落日志。
 */
import * as vscode from 'vscode'
import type { AiChatService } from './chatService'
import type { SecretsService } from '../common/secrets'
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
