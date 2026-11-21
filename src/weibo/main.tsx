/**
 * Webview 入口（微博）：把微博页挂载到根节点，供宿主在编辑区打开独立页面。
 * 主题同步与挂载逻辑统一由 bootstrap 处理；页面自身的状态与协议接线只在 WeiboScreen 内演进。
 */
import { WeiboScreen } from './WeiboScreen'
import { bootstrap } from '../bootstrap'
import '../globals.css'

bootstrap(<WeiboScreen />)
