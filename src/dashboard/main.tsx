/**
 * Webview 入口（仪表盘）：把仪表盘路由外壳挂载到根节点，由页内路由决定展示概览页或写作管理页。
 * 主题同步与挂载逻辑统一由 bootstrap 处理；新增页面只需在路由外壳里登记，不改动本文件。
 */
import { DashboardScreen } from './dashboardScreen'
import { bootstrap } from '../bootstrap'
import '../globals.css'

bootstrap(<DashboardScreen />)
