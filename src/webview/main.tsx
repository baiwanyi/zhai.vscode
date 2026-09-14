/**
 * Webview 入口（仪表盘）：把仪表盘页面挂载到根节点。
 * 主题同步与挂载逻辑统一由 bootstrap 处理；页面组件替换时只需改动下方渲染的节点。
 */
import { bootstrap } from './bootstrap'
import { Dashboard } from './dashboard'
import './globals.css'

bootstrap(<Dashboard />)
