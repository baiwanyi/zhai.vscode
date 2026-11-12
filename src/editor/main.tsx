/**
 * Webview 入口（编辑器）：把编辑器主屏挂载到根节点，主题同步、Provider 与挂载时机统一交给 bootstrap。
 * 复用约定：与仪表盘、工作流两个入口共用 src/bootstrap 与 src/globals.css，不重复实现主题检测。
 * 关键约束：该入口只服务自定义编辑器 webview；编辑器内核与交互扩展只从此处进入产物，
 * 不得被 workflow / dashboard 的依赖图引用，否则会把内核体积带进既有两个面板。
 */
import { EditorScreen } from './EditorScreen'
import { bootstrap } from '../bootstrap'
import '../globals.css'

bootstrap(<EditorScreen />)
