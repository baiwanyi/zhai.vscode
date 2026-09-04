/**
 * Webview 入口：挂载全局搜索面板到根节点。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SearchPanel } from './SearchPanel'
import './index.css'

const container = document.getElementById('root')
if (!container) {
    throw new Error('Webview 根节点 #root 不存在')
}

createRoot(container).render(
    <StrictMode>
        <SearchPanel />
    </StrictMode>,
)
