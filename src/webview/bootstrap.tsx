/**
 * Webview 通用挂载器：把 VS Code 主题同步到 shadcn 的暗色令牌，并挂载 React 根。
 * 各 Webview 入口（仪表盘 / AI 对话）共用，避免主题检测逻辑重复。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { JSX } from 'react'

/** 判定为深色的主题标识，high-contrast 同样使用深色底色 */
const DARK_THEME_KINDS = ['vscode-dark', 'vscode-high-contrast']

/** 依据 VS Code 主题类型在根元素挂载或移除 .dark 类 */
function syncDarkClass(): void {
    const themeKind = document.body.dataset.vscodeThemeKind ?? ''
    document.documentElement.classList.toggle('dark', DARK_THEME_KINDS.includes(themeKind))
}

export function bootstrap(node: JSX.Element): void {
    const container = document.getElementById('root')
    if (!container) {
        throw new Error('Webview 根节点 #root 不存在')
    }
    syncDarkClass()
    new MutationObserver(syncDarkClass).observe(document.body, {
        attributes: true,
        attributeFilter: ['data-vscode-theme-kind'],
    })
    createRoot(container).render(<StrictMode>{node}</StrictMode>)
}
