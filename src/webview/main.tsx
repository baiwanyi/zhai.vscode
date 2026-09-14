/**
 * Webview 入口：挂载全局搜索面板到根节点，并把 VS Code 主题同步到 shadcn 的暗色令牌。
 * 主题来源为 body 上的 data-vscode-theme-kind，编辑器切换主题时通过 MutationObserver 重算 .dark 类。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SearchPanel } from './SearchPanel'
import './index.css'

/** 判定为深色的主题标识，high-contrast 同样使用深色底色 */
const DARK_THEME_KINDS = ['vscode-dark', 'vscode-high-contrast']

/** 依据 VS Code 主题类型在根元素挂载或移除 .dark 类 */
function syncDarkClass(): void {
    const themeKind = document.body.dataset.vscodeThemeKind ?? ''
    document.documentElement.classList.toggle('dark', DARK_THEME_KINDS.includes(themeKind))
}

const container = document.getElementById('root')
if (!container) {
    throw new Error('Webview 根节点 #root 不存在')
}

syncDarkClass()
new MutationObserver(syncDarkClass).observe(document.body, {
    attributes: true,
    attributeFilter: ['data-vscode-theme-kind'],
})

createRoot(container).render(
    <StrictMode>
        <SearchPanel />
    </StrictMode>,
)
