/**
 * Webview 可触发的宿主命令白名单：各视图 Provider 共用，避免任意命令被 Webview 执行。
 * 约束：仅收录「用户主动点击、无破坏性、无需参数」的命令；新增命令须评估越权风险后再登记。
 */
export const WEBVIEW_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
    // 索引维护
    'zhai.rebuildIndex',
    'zhai.clearIndex',
    'zhai.showIndexStatus',
    'zhai.exportDiagnostics',
    // 设置与密钥
    'zhai.openSettings',
    'zhai.ai.setApiKey',
    'zhai.ai.clearApiKey',
    // 面板跳转
    'zhai.openDashboard',
])
