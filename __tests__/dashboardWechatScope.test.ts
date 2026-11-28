/**
 * 公众号模块感知边界：列表页只做导航，账号页才感知工作流区并按路径归属账号。
 * 复用约定：读源码文本做结构断言，与 dashboardRouting 的既有静态检查同一手法，不启动 Webview。
 * 关键约束：列表页不得调用 useWechatModuleSync 或 selectAccount，否则侧栏会在账号列表就显示公众号菜单；
 * 账号页必须同时具备模块同步与按路径 accountId 的账号同步，否则深链进入时菜单归属错误。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 读取源文件文本：路径相对仓库根，测试在工作区根运行 */
function readSource(relativePath: string): string {
    return readFileSync(relativePath, 'utf8')
}

describe('公众号模块感知边界', () => {
    it('账号列表页不感知工作流区：无模块同步、无当前账号写入', () => {
        const source = readSource('src/dashboard/wechat/DashboardWechat.tsx')
        expect(source).not.toContain('useWechatModuleSync')
        expect(source).not.toContain('selectAccount')
    })

    it('账号页感知工作流区：保留模块同步', () => {
        const source = readSource('src/dashboard/wechat/DashboardWechatPost.tsx')
        expect(source).toContain('useWechatModuleSync()')
    })

    it('账号页按路径 accountId 设置宿主当前账号，且已一致时跳过', () => {
        const source = readSource('src/dashboard/wechat/DashboardWechatPost.tsx')
        expect(source).toContain('selectedId !== accountId')
        expect(source).toContain('void selectAccount(accountId)')
    })
})
