/**
 * 作品快照单元测试：覆盖自动留版落盘与时间线、同内容去重、手动留版备注、恢复的覆盖范围与恢复前留底。
 * 虚拟磁盘与目录由 vscode 测试桩承接，快照目录名含随机后缀，断言一律取自服务返回值或 meta 列表。
 * 关键约束：自动快照按间隔节流，用例只验证「首次立即落盘」与「同内容不重复留版」，不去等待定时器。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PressWorkspaceFiles } from '@shared/types/press'
import { readFileContent, resetWorkspaceState, setConfigValue, setFileContent } from './stubs/vscode'
import { PROJECT_README_NAME } from '../../src/modules/press/projectFactory'
import { PressSnapshotService } from '../../src/modules/press/snapshot/snapshotService'
import { listStoredSnapshots } from '../../src/modules/press/snapshot/snapshotStore'

const STORAGE_ROOT = 'd:/vault'
const PROJECT_DIR = 'press/剑来'
const SNAPSHOT_FILE_NAMES: Readonly<Record<keyof PressWorkspaceFiles, string>> = {
    readme: PROJECT_README_NAME,
    setting: '设定.md',
    characters: '角色设定.md',
    outline: '大纲.md',
}

/** 构造四份文档内容：只覆盖需要断言的字段 */
function buildFiles(overrides: Partial<PressWorkspaceFiles> = {}): PressWorkspaceFiles {
    return {
        readme: '---\ntitle: 剑来\n---\n\n# 剑来\n',
        setting: '# 设定\n\n## 提取设定\n\n- 世界观总述：三洲四海\n',
        characters: '# 角色设定\n\n# 陈平安\n',
        outline: '# 大纲\n\n## 分卷规划\n\n- 第一卷：少年游\n',
        ...overrides,
    }
}

/** 把四份文档按真实落点写入虚拟磁盘：恢复用例需要从这里读「当前内容」 */
function seedWorkspace(next: PressWorkspaceFiles): void {
    for (const [key, fileName] of Object.entries(SNAPSHOT_FILE_NAMES) as [keyof PressWorkspaceFiles, string][]) {
        setFileContent(path.join(STORAGE_ROOT, 'press', '剑来', fileName), next[key])
    }
}

/** 读取某一版某份副本的落盘内容 */
function readSnapshotFile(snapshotId: string, fileName: string): string | undefined {
    return readFileContent(path.join(STORAGE_ROOT, 'press', '剑来', 'Snapshots', snapshotId, fileName))
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setConfigValue('press.snapshot.enabled', true)
})

describe('自动留版', () => {
    it('首次变更立即写出四份副本，reason 与触发范围写入时间线', async () => {
        const service = new PressSnapshotService()
        const files = buildFiles()
        await service.recordWorkspaceWrite(PROJECT_DIR, files, ['setting'])
        const list = await service.list(PROJECT_DIR)
        expect(list).toHaveLength(1)
        expect(list[0]?.reason).toBe('auto')
        expect(list[0]?.trigger).toEqual(['setting'])
        expect(list[0]?.changed).toEqual(['readme', 'setting', 'characters', 'outline'])
        const stored = await listStoredSnapshots(PROJECT_DIR)
        const snapshotId = stored[0]?.id ?? ''
        expect(readSnapshotFile(snapshotId, '设定.md')).toBe(files.setting)
        expect(readSnapshotFile(snapshotId, PROJECT_README_NAME)).toBe(files.readme)
    })

    it('内容未变时再次记录不产生新版本', async () => {
        const service = new PressSnapshotService()
        await service.recordWorkspaceWrite(PROJECT_DIR, buildFiles(), ['setting'])
        await service.recordWorkspaceWrite(PROJECT_DIR, buildFiles(), ['characters'])
        expect(await service.list(PROJECT_DIR)).toHaveLength(1)
    })

    it('快照目录被登记，且写入 .gitignore 与 meta.json', async () => {
        const service = new PressSnapshotService()
        await service.recordWorkspaceWrite(PROJECT_DIR, buildFiles(), ['outline'])
        const [snapshot] = await service.list(PROJECT_DIR)
        expect(readSnapshotFile(snapshot?.id ?? '', 'meta.json')).toContain('"version": 1')
        expect(readFileContent(path.join(STORAGE_ROOT, 'press', '剑来', 'Snapshots', '.gitignore'))).toBe('*\n')
    })
})

describe('手动留版', () => {
    it('记录备注与 manual 来源，且内容相同也照常留版', async () => {
        const service = new PressSnapshotService()
        await service.recordWorkspaceWrite(PROJECT_DIR, buildFiles(), ['setting'])
        const created = await service.create(PROJECT_DIR, '改完第一章大纲')
        expect(created.reason).toBe('manual')
        expect(created.label).toBe('改完第一章大纲')
        const list = await service.list(PROJECT_DIR)
        expect(list).toHaveLength(2)
        expect(list.some((item) => item.reason === 'manual')).toBe(true)
    })
})

describe('恢复', () => {
    it('整版覆盖四份文档，并给恢复前的内容留一版', async () => {
        const indexed: string[] = []
        const service = new PressSnapshotService({
            indexFile: (uri): Promise<void> => {
                indexed.push(uri.fsPath)
                return Promise.resolve()
            },
        })
        const original = buildFiles()
        await service.recordWorkspaceWrite(PROJECT_DIR, original, ['setting'])
        const [baseline] = await service.list(PROJECT_DIR)
        const changed = buildFiles({ setting: '# 设定\n\n## 提取设定\n\n- 世界观总述：改坏了\n' })
        seedWorkspace(changed)
        const restored = await service.restore(PROJECT_DIR, baseline?.id ?? '')
        expect(restored).toEqual(['readme', 'setting', 'characters', 'outline'])
        expect(readFileContent(path.join(STORAGE_ROOT, 'press', '剑来', '设定.md'))).toBe(original.setting)
        const list = await service.list(PROJECT_DIR)
        expect(list).toHaveLength(2)
        expect(list.some((item) => item.reason === 'restore')).toBe(true)
        expect(indexed).toHaveLength(4)
    })

    it('内容与所选版本一致时不写盘也不留版', async () => {
        const service = new PressSnapshotService()
        await service.recordWorkspaceWrite(PROJECT_DIR, buildFiles(), ['setting'])
        const [baseline] = await service.list(PROJECT_DIR)
        seedWorkspace(buildFiles())
        expect(await service.restore(PROJECT_DIR, baseline?.id ?? '')).toEqual([])
        expect(await service.list(PROJECT_DIR)).toHaveLength(1)
    })

    it('不存在的快照标识直接报错', async () => {
        const service = new PressSnapshotService()
        await expect(service.restore(PROJECT_DIR, '20260101-000000-abcdef')).rejects.toThrow('快照不存在')
    })
})

describe('删除', () => {
    it('只删除指定版本，其余版本保留', async () => {
        const service = new PressSnapshotService()
        await service.recordWorkspaceWrite(PROJECT_DIR, buildFiles(), ['setting'])
        const created = await service.create(PROJECT_DIR, '第二版')
        expect(await service.remove(PROJECT_DIR, created.id)).toBe(true)
        const list = await service.list(PROJECT_DIR)
        expect(list).toHaveLength(1)
        expect(list[0]?.reason).toBe('auto')
    })
})
