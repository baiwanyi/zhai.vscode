/**
 * 图片目录扫描单元测试：覆盖扩展名口径、非文件条目过滤、目录缺失容错与多目录展开顺序。
 * 虚拟磁盘与目录由 vscode 测试桩承接，断言只取 listImageFiles 的返回片段，不触碰真实文件系统。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue, setDirectory, setFileContent } from './stubs/vscode'
import { listImageFiles } from '../src/modules/imagegen/imageDirScan'

const STORAGE_ROOT = 'd:/vault'
const PROJECT_SEGMENTS = ['press', '剑来']

/** 作品目录下某个图片目录的绝对路径 */
function dirFsPath(dirName: string): string {
    return path.join(STORAGE_ROOT, ...PROJECT_SEGMENTS, dirName)
}

/** 在指定图片目录下登记一个文件 */
function addFile(dirName: string, fileName: string): void {
    setFileContent(path.join(dirFsPath(dirName), fileName), 'x')
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setDirectory(path.join(STORAGE_ROOT, ...PROJECT_SEGMENTS))
})

describe('listImageFiles', () => {
    it('只返回图片文件，忽略侧车、说明文件与子目录', async () => {
        setDirectory(dirFsPath('Images'))
        addFile('Images', 'photo-20260101010101-AbCd1234.png')
        addFile('Images', 'photo-20260101010101-AbCd1234.json')
        addFile('Images', 'note.txt')
        setDirectory(path.join(dirFsPath('Images'), 'thumbs'))

        const files = await listImageFiles(PROJECT_SEGMENTS, ['Images'])

        expect(files.map((file) => file.name)).toEqual(['photo-20260101010101-AbCd1234.png'])
    })

    it('png / jpg / jpeg / webp / gif 都算图片，其余扩展名排除', async () => {
        setDirectory(dirFsPath('Images'))
        for (const name of ['a.png', 'b.jpg', 'c.jpeg', 'd.webp', 'e.gif', 'f.bmp', 'g.svg']) {
            addFile('Images', name)
        }

        const names = (await listImageFiles(PROJECT_SEGMENTS, ['Images'])).map((file) => file.name).sort()

        expect(names).toEqual(['a.png', 'b.jpg', 'c.jpeg', 'd.webp', 'e.gif'])
    })

    it('目录不存在时跳过而不抛错', async () => {
        setDirectory(dirFsPath('Images'))
        addFile('Images', 'a.png')

        const files = await listImageFiles(PROJECT_SEGMENTS, ['Cover', 'Images'])

        expect(files.map((file) => file.segments.join('/'))).toEqual(['press/剑来/Images/a.png'])
    })

    it('按传入顺序展开多个目录并给出完整片段与 Uri', async () => {
        setDirectory(dirFsPath('Images'))
        addFile('Images', 'a.png')
        setDirectory(dirFsPath('Portraits'))
        addFile('Portraits', 'b.png')

        const files = await listImageFiles(PROJECT_SEGMENTS, ['Portraits', 'Images'])

        expect(files.map((file) => file.segments)).toEqual([
            ['press', '剑来', 'Portraits', 'b.png'],
            ['press', '剑来', 'Images', 'a.png'],
        ])
        expect(files[0]?.uri.fsPath).toBe(path.join(dirFsPath('Portraits'), 'b.png'))
    })

    it('目录为空时返回空数组', async () => {
        setDirectory(dirFsPath('Images'))

        await expect(listImageFiles(PROJECT_SEGMENTS, ['Images'])).resolves.toEqual([])
    })
})
