/**
 * Webview 入口（工作流）：把工作流宿主挂载到根节点，由宿主按模块类型与进入场景解析出应展示的页面。
 * 主题同步与挂载逻辑统一由 bootstrap 处理；页面组件替换时只需改动下方渲染的节点。
 */
import { Host } from './core/host'
import { bootstrap } from '../bootstrap'
import '../globals.css'

bootstrap(<Host />)
