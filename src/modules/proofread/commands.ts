/**
 * 校对命令注册：配置 AI 特征检测所需的朱雀 API Key。
 * 复用约定：密钥读写统一走 SecretsService（系统加密存储），操作反馈优先走 Webview 的 sonner，
 * 无视图时由 ToastService 回退原生提示；命令同样登记在 Webview 白名单，供页面内「配置密钥」按钮触发。
 * 关键约束：密钥只进 SecretStorage，禁止写入 settings.json 或日志；输入留空表示清除既有 Key，
 * 取消输入不做任何变更，避免误删。
 */
import * as vscode from 'vscode'
import type { SecretsService } from '../common/secrets'
import type { ToastService } from '../common/toastService'

/** 密钥长度上限：异常粘贴直接截断，避免超长字符串进加密存储 */
const MAX_KEY_LENGTH = 512

export function registerProofreadCommands(
    context: vscode.ExtensionContext,
    secrets: SecretsService,
    toast: ToastService,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('zhai.proofread.setZhuqueKey', async () => {
            const input = await vscode.window.showInputBox({
                title: '配置朱雀 API Key',
                prompt: '在 EdgeOne 控制台 Makers - Models - API Key 创建，仅保存在本机加密存储；留空表示清除',
                password: true,
                ignoreFocusOut: true,
            })
            if (input === undefined) {
                return
            }
            const value = input.trim().slice(0, MAX_KEY_LENGTH)
            if (value.length === 0) {
                await secrets.remove('zhuqueApiKey')
                toast.notifyOrShow('info', '已清除朱雀 API Key')
                return
            }
            await secrets.set('zhuqueApiKey', value)
            toast.notifyOrShow('success', '朱雀 API Key 已保存')
        }),
    )
}
