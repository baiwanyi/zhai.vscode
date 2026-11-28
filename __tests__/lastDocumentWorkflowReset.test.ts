/**
 * 最后文档关闭的工作流重置契约：编辑区没有文档 tab 时移除公众号/作品专属菜单。
 * 复用约定：读源码文本做结构断言，与 dashboardWechatScope 同一手法，不启动 VS Code。
 * 关键约束：activeDocument 必须在所有文档 tab 关闭时广播事件并清空活跃事实；
 * WorkflowRouter 必须订阅该事件并重置到 root 事实，不能用沿用上次事实的 refresh 代替。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 读取源文件文本：路径相对仓库根，测试在工作区根运行 */
function readSource(relativePath: string): string {
    return readFileSync(relativePath, 'utf8')
}

describe('最后文档关闭重置工作流区', () => {
    it('activeDocument 在文档 tab 全关时广播事件并清空活跃事实', () => {
        const source = readSource('src/modules/editor/activeDocument.ts')
        expect(source).toContain('onDidCloseLastDocument')
        expect(source).toContain('tabGroups.onDidChangeTabs')
        expect(source).toContain('setActiveDocument(null)')
        expect(source).toContain('lastDocumentEmitter.fire()')
        // 形态切换事务期间不广播，避免关旧 tab 开新 tab 的中间态误清
        expect(source).toContain('holdDepth > 0')
    })

    it('WorkflowRouter 订阅事件并重置到 root 事实', () => {
        const source = readSource('src/modules/ai/workflowRouter.ts')
        expect(source).toContain('onDidCloseLastDocument(() => this.resetOnLastDocumentClosed())')
        expect(source).toContain('private resetOnLastDocumentClosed(): void')
        expect(source).toContain('module: ROOT_MODULE_KEY')
        expect(source).toContain('selectedModule: null')
        expect(source).toContain('projectDir: null')
        expect(source).toContain('this.emitter.fire(next)')
    })
})
