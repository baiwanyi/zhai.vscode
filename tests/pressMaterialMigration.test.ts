/**
 * 素材目录迁移：覆盖旧版 `_import` 整体重命名到 Materials 的四种分支——
 * 只有旧目录时迁移、新目录已存在时不动旧目录、两者都不存在时不做任何写入、重命名失败时不抛错。
 * 复用约定：直接调用 press/importAnalysis 的迁移函数，路径口径与宿主一致（storage 根 + 作品段 + 目录名）。
 * 关键约束：迁移只在「新目录不存在」时发生，任何分支都不得覆盖或删除已有素材。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import {
    hasDirectory,
    readFileContent,
    resetWorkspaceState,
    setConfigValue,
    setDirectory,
    setFileContent,
} from './stubs/vscode'
import { migrateLegacyMaterialDirectory } from '../src/modules/press/importAnalysis'

/** 存储根：与 config.test 一致，用盘符路径避免 Uri.file 产出相对路径 */
const STORAGE_ROOT = 'D:\\vault'
/** 作品目录：迁移函数接收的相对作品路径 */
const PROJECT_DIR = 'press/白蛇'

/** 拼出作品目录下某个子目录的绝对路径 */
function projectPath(name: string): string {
    return path.join(STORAGE_ROOT, 'press', '白蛇', name)
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('migrateLegacyMaterialDirectory', () => {
    it('只有旧目录时整体迁移到 Materials，文件随目录一起搬走', async () => {
        setDirectory(projectPath('_import'))
        setFileContent(path.join(projectPath('_import'), 'characters.md'), '## 陆远')

        await migrateLegacyMaterialDirectory(PROJECT_DIR)

        expect(hasDirectory(projectPath('Materials'))).toBe(true)
        expect(hasDirectory(projectPath('_import'))).toBe(false)
        expect(readFileContent(path.join(projectPath('Materials'), 'characters.md'))).toBe('## 陆远')
    })

    it('新目录已存在时不动旧目录，避免覆盖已有素材', async () => {
        setDirectory(projectPath('_import'))
        setFileContent(path.join(projectPath('_import'), 'characters.md'), '旧内容')
        setDirectory(projectPath('Materials'))
        setFileContent(path.join(projectPath('Materials'), 'characters.md'), '新内容')

        await migrateLegacyMaterialDirectory(PROJECT_DIR)

        expect(hasDirectory(projectPath('_import'))).toBe(true)
        expect(readFileContent(path.join(projectPath('Materials'), 'characters.md'))).toBe('新内容')
    })

    it('新旧目录都不存在时不做任何写入', async () => {
        await migrateLegacyMaterialDirectory(PROJECT_DIR)

        expect(hasDirectory(projectPath('Materials'))).toBe(false)
        expect(hasDirectory(projectPath('_import'))).toBe(false)
    })

    it('重命名失败时只记日志，不抛错也不丢素材', async () => {
        setDirectory(projectPath('_import'))
        setFileContent(path.join(projectPath('_import'), 'volumes.md'), '# 卷纲')
        vi.spyOn(vscode.workspace.fs, 'rename').mockRejectedValue(new Error('EBUSY: 资源被占用'))

        await expect(migrateLegacyMaterialDirectory(PROJECT_DIR)).resolves.toBeUndefined()

        expect(hasDirectory(projectPath('_import'))).toBe(true)
        expect(readFileContent(path.join(projectPath('_import'), 'volumes.md'))).toBe('# 卷纲')
    })
})
