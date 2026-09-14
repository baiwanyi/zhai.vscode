/**
 * Webview 入口（AI 对话）：把 AI 对话页挂载到根节点。
 * 主题同步与挂载逻辑统一由 bootstrap 处理；页面组件替换时只需改动下方渲染的节点。
 */
import { AiChat } from './ai-chat'
import { bootstrap } from './bootstrap'
import './globals.css'

bootstrap(<AiChat />)
