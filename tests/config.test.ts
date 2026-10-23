/**
 * config 单元测试：覆盖存储根解析的容错分支与索引缓存目录的解析规则。
 * 重点验证：盘符正斜杠写法被规范为反斜杠（否则 Uri.file 会产出被 workspace.fs 拒绝的相对路径）；
 * 未配置时回退到用户主目录下的 .zhai；缓存目录固定为全局存储目录的兄弟目录 zhai.vscode。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { resetWorkspaceState, setConfigValue } from './stubs/vscode'
import { resolveCacheRoot, resolveStorageRoot } from '../src/modules/common/config'

beforeEach(() => {
    resetWorkspaceState()
})

describe('resolveStorageRoot', () => {
    it('盘符正斜杠写法规范为反斜杠', () => {
        setConfigValue('storage.rootPath', 'd:/vault')
        expect(resolveStorageRoot().fsPath).toBe('d:\\vault')
    })

    it('盘符反斜杠写法保持原样', () => {
        setConfigValue('storage.rootPath', 'D:\\vault')
        expect(resolveStorageRoot().fsPath).toBe('D:\\vault')
    })

    it('去除首尾空格后再规范化', () => {
        setConfigValue('storage.rootPath', '  d:/notes/vault  ')
        expect(resolveStorageRoot().fsPath).toBe('d:\\notes\\vault')
    })

    it('非盘符路径（如 UNC）保持原样，不破坏 authority 解析', () => {
        setConfigValue('storage.rootPath', '//server/share')
        expect(resolveStorageRoot().fsPath).toBe('//server/share')
    })

    it('未配置时回退到用户主目录下的 .zhai', () => {
        expect(resolveStorageRoot().fsPath).toBe(path.join(os.homedir(), '.zhai'))
    })
})

describe('resolveCacheRoot', () => {
    const storeRoot = path.join(os.tmpdir(), 'globalStorage')
    const globalStorageUri = vscode.Uri.file(path.join(storeRoot, 'zhai.zhai-vscode'))

    it('取全局存储目录的兄弟目录，文件夹名固定为 zhai.vscode', () => {
        expect(resolveCacheRoot(globalStorageUri).fsPath).toBe(path.join(storeRoot, 'zhai.vscode'))
    })

    it('目录名不随扩展标识变化', () => {
        const other = vscode.Uri.file(path.join(storeRoot, 'some.other-extension'))
        expect(path.basename(resolveCacheRoot(other).fsPath)).toBe('zhai.vscode')
    })

    it('结果独立于传入的全局存储目录本身', () => {
        expect(resolveCacheRoot(globalStorageUri).fsPath).not.toBe(globalStorageUri.fsPath)
    })
})
