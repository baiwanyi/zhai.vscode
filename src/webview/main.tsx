/**
 * Webview 入口（全局搜索）：挂载搜索面板到根节点。
 * 主题同步与挂载逻辑统一由 bootstrap 处理。
 */
import { bootstrap } from './bootstrap'
import { SearchPanel } from './SearchPanel'
import './index.css'

bootstrap(<SearchPanel />)
