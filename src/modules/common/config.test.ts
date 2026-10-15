/**
 * config 单元测试：覆盖存储根解析的两条分支与用户配置写法的容错。
 * 重点验证：盘符正斜杠写法被规范为反斜杠（否则 Uri.file 会产出被 workspace.fs 拒绝的相对路径）；
 * 未配置时回退到用户主目录下的 .zhai，不再依赖工作区是否打开。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue } from '@/tests/stubs/vscode'
import { resolveStorageRoot } from './config'

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
