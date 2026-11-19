/**
 * 微博面板（编辑区）：在编辑器区域打开独立 webview 页，承载微博发布框与时间线。
 * 复用约定：HTML 与 CSP 注入走 common/webviewHtml，与仪表盘、富文本编辑器共用同一份构建产物加载逻辑；
 * 面板标识取 shared/types/workflow，工作流路由用它把「活跃标签是微博」映射为微博语境；
 * 单例持有面板句柄，重复打开只聚焦已有页，关闭后置空以便下次重建。
 * 关键约束：本地资源根只放行 dist/webview；构建产物缺失时报出可执行提示而不是留空白 tab；
 * 标签图标取 resources/icons/weibo-tab.svg（品牌红环 + 黄色信号弧，去掉中间黑色眼睛），不分 light/dark 两套；
 * 开启 retainContextWhenHidden 让切走再回来不重建页面，发布框草稿不会因切 tab 丢失；
 * 面板激活、失焦与销毁都要经 activeDocument 上报/让位——侧栏是否跟随标签全靠这一处事实，
 * 漏报会让工作流区停在上一页面；关闭时必须同时清理事实与句柄。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { buildWebviewHtml } from '@modules/common/webviewHtml'
import { getActivePanel, reportActivePanel } from '@modules/editor/activeDocument'
import { WEIBO_PANEL_VIEW_TYPE } from '@shared/types/workflow'

/** 当前面板：关闭后置空，重复打开时聚焦而不是再开一页 */
let current: vscode.WebviewPanel | null = null

/** 打开微博面板：已存在则聚焦，否则在编辑区新开一页 */
export async function openWeiboPanel(extensionUri: vscode.Uri): Promise<void> {
    if (current !== null) {
        current.reveal()
        return
    }
    const panel = vscode.window.createWebviewPanel(WEIBO_PANEL_VIEW_TYPE, '微博', vscode.ViewColumn.Active, {
        enableScripts: true,
        // 切到其它 tab 再回来不重建页面：发布框里未提交的草稿活在前端状态里，重建会直接丢掉
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    })
    current = panel
    // 标签图标用固定品牌红：SVG 里写死颜色，不跟随主题分两套
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'icons', 'weibo-tab.svg')
    // 面板拿到焦点即上报：工作流区据此切到微博语境；切走时让位，编辑器重新激活由活跃文档侧统一清空
    if (panel.active) {
        reportActivePanel(WEIBO_PANEL_VIEW_TYPE)
    }
    panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
            reportActivePanel(WEIBO_PANEL_VIEW_TYPE)
            return
        }
        if (getActivePanel() === WEIBO_PANEL_VIEW_TYPE) {
            reportActivePanel(null)
        }
    })
    panel.onDidDispose(() => {
        if (getActivePanel() === WEIBO_PANEL_VIEW_TYPE) {
            reportActivePanel(null)
        }
        if (current === panel) {
            current = null
        }
    })
    try {
        panel.webview.html = await buildWebviewHtml(panel.webview, extensionUri, 'weibo/index.html')
    } catch (error) {
        panel.webview.html = `<html><body><h3>宅写作</h3><p>微博页面资源缺失，请先执行 pnpm run compile（${String(
            error,
        )}）</p></body></html>`
        logger.error('微博面板资源加载失败', error)
    }
}
