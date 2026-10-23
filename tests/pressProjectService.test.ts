/**
 * projectService / projectFactory 单元测试：覆盖作品名校验、骨架落盘与索引触发、重名拒绝与打开路径校验，
 * 卷的重命名（保留序号前缀、同步索引）与删除（移入回收站、按前缀清理索引），
 * 整部作品的删除（回收站优先、回收站不可用时降级永久删除并回传结果），
 * 以及章节的删除（清理单文件索引、拦下脏文档）与跨卷移动（重排序号、冲突递增、递归到未分卷）。
 * 虚拟磁盘、目录与可打开文档由 vscode 测试桩承接，回收站可用性由桩注入，不触达真实文件系统；
 * 路径断言统一用 node:path 规范化，与实现一样规避分隔符差异。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    hasDirectory,
    readDeletedPaths,
    readFileContent,
    readOpenedDocumentPaths,
    registerDirtyTextDocument,
    registerTextDocument,
    resetWorkspaceState,
    setConfigValue,
    setDirectory,
    setFileContent,
    setTrashAvailable,
} from './stubs/vscode'
import type { ProjectIndexer } from '../src/modules/press/projectService'
import { buildRenamedVolumeDirName, validateProjectName, validateVolumeName } from '../src/modules/press/projectFactory'
import {
    createChapter,
    createProject,
    createVolume,
    deleteChapter,
    deleteProject,
    deleteVolume,
    moveChapter,
    openChapterByPath,
    openProjectByDir,
    renameVolume,
} from '../src/modules/press/projectService'

const STORAGE_ROOT = 'd:/vault'

/**
 * 构造记录索引调用的替身：indexed 收集被索引的绝对路径，
 * removed 收集按前缀清理的记录，removedFiles 收集按完整路径清理的记录。
 */
function createIndexer(): {
    indexer: ProjectIndexer
    indexed: string[]
    removed: string[]
    removedFiles: string[]
} {
    const indexed: string[] = []
    const removed: string[] = []
    const removedFiles: string[] = []
    const indexer: ProjectIndexer = {
        indexFile: (uri) => {
            indexed.push(uri.fsPath)
            return Promise.resolve()
        },
        removeFilesUnder: (relativePrefix) => {
            removed.push(relativePrefix)
        },
        removeFile: (relativePath) => {
            removedFiles.push(relativePath)
        },
    }
    return { indexer, indexed, removed, removedFiles }
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('validateProjectName', () => {
    it('接受中文名与含空格的常规名', () => {
        expect(validateProjectName('剑来')).toBeNull()
        expect(validateProjectName('凡人修仙传 第一部')).toBeNull()
        expect(validateProjectName('conan')).toBeNull()
    })

    it('拒绝空名与超长名', () => {
        expect(validateProjectName('')).toBe('作品名不能为空')
        expect(validateProjectName('作'.repeat(61))).toBe('作品名不能超过 60 个字符')
    })

    it('拒绝路径分隔符、盘符与非法字符', () => {
        for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
            expect(validateProjectName(name)).toBe('作品名不能包含 \\ / : * ? " < > | 等非法字符')
        }
    })

    it('拒绝控制字符与 . / ..', () => {
        expect(validateProjectName('剑\u0007来')).toBe('作品名不能包含 \\ / : * ? " < > | 等非法字符')
        expect(validateProjectName('.')).toBe('作品名不能为 . 或 ..')
        expect(validateProjectName('..')).toBe('作品名不能为 . 或 ..')
    })

    it('拒绝以空格开头或以空格、点结尾的名字', () => {
        const reason = '作品名不能以空格开头，也不能以空格或点结尾'
        expect(validateProjectName(' 剑来')).toBe(reason)
        expect(validateProjectName('剑来 ')).toBe(reason)
        expect(validateProjectName('剑来.')).toBe(reason)
    })

    it('拒绝系统保留名及其带扩展名的变体', () => {
        expect(validateProjectName('CON')).toBe('作品名不能使用系统保留名：CON')
        expect(validateProjectName('con.md')).toBe('作品名不能使用系统保留名：con.md')
        expect(validateProjectName('LPT9')).toBe('作品名不能使用系统保留名：LPT9')
    })
})

describe('createProject', () => {
    it('生成骨架目录与五份文档（含卷1首章），并逐份纳入索引', async () => {
        const { indexer, indexed } = createIndexer()
        const created = await createProject(indexer, { name: '剑来', audience: '男频' })

        expect(created.dirPath).toBe('press/剑来')
        expect(created.title).toBe('剑来')
        const directory = path.join(STORAGE_ROOT, 'press', '剑来')
        expect(hasDirectory(directory)).toBe(true)
        expect(hasDirectory(path.join(directory, 'Chapter'))).toBe(true)
        expect(hasDirectory(path.join(directory, 'Chapter', '01-卷1'))).toBe(true)
        expect(readFileContent(path.join(directory, 'README.md'))).toContain('title: 剑来')
        expect(readFileContent(path.join(directory, 'README.md'))).toContain('audience: 男频')
        expect(readFileContent(path.join(directory, '大纲.md'))).toContain('# 大纲')
        expect(readFileContent(path.join(directory, '角色设定.md'))).toContain('# 角色设定')
        expect(readFileContent(path.join(directory, '设定.md'))).toContain('# 设定')
        const firstChapter = path.join(directory, 'Chapter', '01-卷1', '01-未命名章节.md')
        expect(readFileContent(firstChapter)).toContain('title: 01 未命名章节')
        expect(indexed).toEqual([
            path.join(directory, 'README.md'),
            path.join(directory, '大纲.md'),
            path.join(directory, '角色设定.md'),
            path.join(directory, '设定.md'),
            firstChapter,
        ])
    })

    it('作品名去首尾空格后再落盘', async () => {
        const { indexer } = createIndexer()
        const created = await createProject(indexer, { name: ' 剑来 ', audience: '女频' })

        expect(created.dirPath).toBe('press/剑来')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '剑来'))).toBe(true)
    })

    it('同名作品已存在时拒绝创建且不重复索引', async () => {
        const { indexer, indexed } = createIndexer()
        await createProject(indexer, { name: '剑来', audience: '男频' })
        const countAfterFirst = indexed.length

        await expect(createProject(indexer, { name: '剑来', audience: '女频' })).rejects.toThrow('作品已存在：剑来')
        expect(indexed).toHaveLength(countAfterFirst)
    })

    it('作品名非法时不触碰文件系统', async () => {
        const { indexer, indexed } = createIndexer()

        await expect(createProject(indexer, { name: '../evil', audience: '男频' })).rejects.toThrow('作品名不能包含')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '..', 'evil'))).toBe(false)
        expect(indexed).toEqual([])
    })
})

describe('openProjectByDir', () => {
    it('按作品目录打开 README.md', async () => {
        const target = path.join(STORAGE_ROOT, 'press', '剑来', 'README.md')
        registerTextDocument(target, ['# 剑来'])

        await openProjectByDir('press/剑来')

        expect(readOpenedDocumentPaths()).toEqual([target])
    })

    it('拒绝非 press 模块或层级不符的目录', async () => {
        await expect(openProjectByDir('press')).rejects.toThrow('作品路径非法：press')
        await expect(openProjectByDir('notes/a')).rejects.toThrow('作品路径非法：notes/a')
        await expect(openProjectByDir('press/剑来/Chapter')).rejects.toThrow('作品路径非法：press/剑来/Chapter')
    })

    it('拒绝上跳片段，不触达编辑器', async () => {
        await expect(openProjectByDir('press/../secret')).rejects.toThrow('作品路径非法')
        expect(readOpenedDocumentPaths()).toEqual([])
    })

    it('README 缺失时把读取错误上抛', async () => {
        await expect(openProjectByDir('press/雪中')).rejects.toThrow('ENOENT')
        expect(readOpenedDocumentPaths()).toEqual([])
    })
})

describe('createChapter', () => {
    it('作品还没有卷时落到默认卷1并立即索引', async () => {
        const { indexer, indexed } = createIndexer()

        const created = await createChapter(indexer, { dirPath: 'press/剑来', chapterPaths: [] })

        expect(created.path).toBe('press/剑来/Chapter/01-卷1/01-未命名章节.md')
        expect(created.title).toBe('01 未命名章节')
        expect(created.volume).toBe('卷1')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1'))).toBe(true)
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain('title: 01 未命名章节')
        expect(indexed).toEqual([path.join(STORAGE_ROOT, created.path)])
    })

    it('未指定卷时追加到序号最大的卷，卷内序号顺延', async () => {
        const { indexer } = createIndexer()

        const created = await createChapter(indexer, {
            dirPath: 'press/剑来',
            chapterPaths: ['press/剑来/Chapter/01-第一卷/01-初遇.md', 'press/剑来/Chapter/02-第二卷/03-远行.md'],
        })

        expect(created.path).toBe('press/剑来/Chapter/02-第二卷/04-未命名章节.md')
        expect(created.volume).toBe('第二卷')
    })

    it('指定卷时落到该卷，序号按卷内已有章节计算', async () => {
        const { indexer } = createIndexer()

        const created = await createChapter(indexer, {
            dirPath: 'press/剑来',
            chapterPaths: [
                'press/剑来/Chapter/01-第一卷/01-初遇.md',
                'press/剑来/Chapter/01-第一卷/05-重逢.md',
                'press/剑来/Chapter/02-第二卷/09-远行.md',
            ],
            volumeDir: '01-第一卷',
        })

        expect(created.path).toBe('press/剑来/Chapter/01-第一卷/06-未命名章节.md')
        expect(created.volume).toBe('第一卷')
    })

    it('目标文件名已存在时递增序号且不覆盖', async () => {
        const { indexer } = createIndexer()
        const occupied = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '01-未命名章节.md')
        setFileContent(occupied, '既有内容')

        const created = await createChapter(indexer, { dirPath: 'press/剑来', chapterPaths: [] })

        expect(created.path).toBe('press/剑来/Chapter/01-卷1/02-未命名章节.md')
        expect(readFileContent(occupied)).toBe('既有内容')
    })

    it('卷目录非法时拒绝落盘', async () => {
        const { indexer, indexed } = createIndexer()

        await expect(
            createChapter(indexer, { dirPath: 'press/剑来', chapterPaths: [], volumeDir: '../evil' }),
        ).rejects.toThrow('卷目录非法')
        expect(indexed).toEqual([])
    })

    it('作品目录非法时拒绝落盘', async () => {
        const { indexer, indexed } = createIndexer()

        await expect(createChapter(indexer, { dirPath: 'notes/剑来', chapterPaths: [] })).rejects.toThrow(
            '作品路径非法',
        )
        await expect(createChapter(indexer, { dirPath: 'press', chapterPaths: [] })).rejects.toThrow('作品路径非法')
        expect(indexed).toEqual([])
    })
})

describe('createVolume', () => {
    it('作品还没有卷时新建卷1并写入首章', async () => {
        const { indexer, indexed } = createIndexer()

        const created = await createVolume(indexer, { dirPath: 'press/剑来', chapterPaths: [] })

        expect(created.volumeDir).toBe('01-卷1')
        expect(created.volumeName).toBe('卷1')
        expect(created.chapterPath).toBe('press/剑来/Chapter/01-卷1/01-未命名章节.md')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1'))).toBe(true)
        expect(indexed).toEqual([path.join(STORAGE_ROOT, created.chapterPath)])
    })

    it('已有卷时按最大卷序号顺延', async () => {
        const { indexer } = createIndexer()

        const created = await createVolume(indexer, {
            dirPath: 'press/剑来',
            chapterPaths: ['press/剑来/Chapter/01-卷1/01-初遇.md', 'press/剑来/Chapter/05-卷5/02-远行.md'],
        })

        expect(created.volumeDir).toBe('06-卷6')
        expect(created.volumeName).toBe('卷6')
    })

    it('同名卷目录已存在时递增序号且不覆盖', async () => {
        const { indexer } = createIndexer()
        const occupiedDirectory = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1')
        const occupiedChapter = path.join(occupiedDirectory, '占位.md')
        setFileContent(occupiedChapter, '既有内容')

        const created = await createVolume(indexer, {
            dirPath: 'press/剑来',
            chapterPaths: ['press/剑来/Chapter/01-卷1/占位.md'],
        })

        expect(created.volumeDir).toBe('02-卷2')
        expect(readFileContent(occupiedChapter)).toBe('既有内容')
    })

    it('作品目录非法时拒绝新建', async () => {
        const { indexer, indexed } = createIndexer()

        await expect(createVolume(indexer, { dirPath: 'notes/剑来', chapterPaths: [] })).rejects.toThrow('作品路径非法')
        expect(indexed).toEqual([])
    })
})

describe('openChapterByPath', () => {
    it('打开 Chapter/ 下的章节文档', async () => {
        const target = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-初见.md')
        registerTextDocument(target, ['# 初见'])

        await openChapterByPath('press/剑来/Chapter/01-初见.md')

        expect(readOpenedDocumentPaths()).toEqual([target])
    })

    it('拒绝非 Chapter 层级、其他模块与越界路径', async () => {
        await expect(openChapterByPath('press/剑来/README.md')).rejects.toThrow('章节路径非法')
        await expect(openChapterByPath('press/剑来/Chapter')).rejects.toThrow('章节路径非法')
        await expect(openChapterByPath('notes/a/Chapter/x.md')).rejects.toThrow('章节路径非法')
        await expect(openChapterByPath('press/../x/Chapter/a.md')).rejects.toThrow('章节路径非法')
        expect(readOpenedDocumentPaths()).toEqual([])
    })
})

describe('buildRenamedVolumeDirName', () => {
    it('保留原有序号前缀，仅替换可读部分', () => {
        expect(buildRenamedVolumeDirName('01-卷1', '风起长安')).toBe('01-风起长安')
        expect(buildRenamedVolumeDirName('12_旧名', '新名')).toBe('12-新名')
    })

    it('原目录无序号前缀时不凭空补前缀', () => {
        expect(buildRenamedVolumeDirName('卷1', '风起长安')).toBe('风起长安')
    })
})

describe('validateVolumeName', () => {
    it('复用作品名的名称规则，文案为卷名', () => {
        expect(validateVolumeName('风起长安')).toBeNull()
        expect(validateVolumeName('')).toBe('卷名不能为空')
        expect(validateVolumeName('a/b')).toBe('卷名不能包含 \\ / : * ? " < > | 等非法字符')
        expect(validateVolumeName('CON')).toBe('卷名不能使用系统保留名：CON')
    })
})

describe('renameVolume', () => {
    it('保留序号前缀重命名目录，并按新路径重建索引', async () => {
        const { indexer, indexed, removed } = createIndexer()
        const volumePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1')
        setDirectory(volumePath)
        setFileContent(path.join(volumePath, '01-初遇.md'), '# 初遇')

        const renamed = await renameVolume(indexer, {
            dirPath: 'press/剑来',
            volumeDir: '01-卷1',
            name: '风起长安',
            volumeFilePaths: ['press/剑来/Chapter/01-卷1/01-初遇.md'],
        })

        expect(renamed).toEqual({ volumeDir: '01-风起长安', volumeName: '风起长安' })
        const renamedPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-风起长安', '01-初遇.md')
        expect(indexed).toEqual([renamedPath])
        expect(readFileContent(renamedPath)).toBe('# 初遇')
        // 先清旧前缀再建新索引，两处顺序即断言顺序
        expect(removed).toEqual(['press/剑来/Chapter/01-卷1/'])
    })

    it('原目录无序号前缀时新目录也不带前缀', async () => {
        const { indexer } = createIndexer()
        setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '外传'))

        const renamed = await renameVolume(indexer, {
            dirPath: 'press/剑来',
            volumeDir: '外传',
            name: '番外',
            volumeFilePaths: [],
        })

        expect(renamed.volumeDir).toBe('番外')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '番外'))).toBe(true)
    })

    it('新卷名与原卷名一致时直接返回，不移动目录', async () => {
        const { indexer, removed } = createIndexer()
        setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1'))

        const renamed = await renameVolume(indexer, {
            dirPath: 'press/剑来',
            volumeDir: '01-卷1',
            name: '卷1',
            volumeFilePaths: [],
        })

        expect(renamed.volumeDir).toBe('01-卷1')
        expect(removed).toEqual([])
    })

    it('目标卷目录已存在时拒绝，且不改动原目录', async () => {
        const { indexer, removed } = createIndexer()
        const volumePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1')
        setDirectory(volumePath)
        setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-番外'))

        await expect(
            renameVolume(indexer, {
                dirPath: 'press/剑来',
                volumeDir: '01-卷1',
                name: '番外',
                volumeFilePaths: [],
            }),
        ).rejects.toThrow('卷已存在：01-番外')
        expect(hasDirectory(volumePath)).toBe(true)
        expect(removed).toEqual([])
    })

    it('卷名非法时拒绝，不触碰文件系统', async () => {
        const { indexer, indexed } = createIndexer()
        const volumePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1')
        setDirectory(volumePath)

        await expect(
            renameVolume(indexer, { dirPath: 'press/剑来', volumeDir: '01-卷1', name: '../evil', volumeFilePaths: [] }),
        ).rejects.toThrow('卷名不能包含')
        expect(hasDirectory(volumePath)).toBe(true)
        expect(indexed).toEqual([])
    })

    it('卷不存在时报错', async () => {
        const { indexer } = createIndexer()

        await expect(
            renameVolume(indexer, {
                dirPath: 'press/剑来',
                volumeDir: '01-卷1',
                name: '风起长安',
                volumeFilePaths: [],
            }),
        ).rejects.toThrow('卷不存在：01-卷1')
    })
})

describe('deleteVolume', () => {
    it('删除整卷目录并清理该卷的索引记录', async () => {
        const { indexer, removed } = createIndexer()
        const volumePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1')
        setDirectory(volumePath)
        setFileContent(path.join(volumePath, '01-初遇.md'), '# 初遇')

        await deleteVolume(indexer, { dirPath: 'press/剑来', volumeDir: '01-卷1' })

        expect(hasDirectory(volumePath)).toBe(false)
        expect(readFileContent(path.join(volumePath, '01-初遇.md'))).toBeUndefined()
        expect(readDeletedPaths()).toEqual([volumePath])
        expect(removed).toEqual(['press/剑来/Chapter/01-卷1/'])
    })

    it('卷不存在时拒绝，不产生删除调用', async () => {
        const { indexer, removed } = createIndexer()

        await expect(deleteVolume(indexer, { dirPath: 'press/剑来', volumeDir: '02-卷2' })).rejects.toThrow(
            '卷不存在：02-卷2',
        )
        expect(readDeletedPaths()).toEqual([])
        expect(removed).toEqual([])
    })

    it('卷目录非法时拒绝，不触达文件系统', async () => {
        const { indexer } = createIndexer()

        await expect(deleteVolume(indexer, { dirPath: 'press/剑来', volumeDir: '../evil' })).rejects.toThrow(
            '卷目录非法',
        )
        expect(readDeletedPaths()).toEqual([])
    })
})

describe('deleteProject', () => {
    it('删除整部作品：目录与章节一并移入回收站，并按前缀清理索引', async () => {
        const { indexer, removed } = createIndexer()
        const projectPath = path.join(STORAGE_ROOT, 'press', '娱乐春秋')
        setDirectory(projectPath)
        setFileContent(path.join(projectPath, 'README.md'), '# 娱乐春秋')
        setFileContent(path.join(projectPath, 'Chapter', '01-卷1', '01-初遇.md'), '# 初遇')

        const outcome = await deleteProject(indexer, { dirPath: 'press/娱乐春秋' })

        expect(outcome).toBe('trash')
        expect(readDeletedPaths()).toEqual([projectPath])
        expect(readFileContent(path.join(projectPath, 'README.md'))).toBeUndefined()
        expect(readFileContent(path.join(projectPath, 'Chapter', '01-卷1', '01-初遇.md'))).toBeUndefined()
        expect(removed).toEqual(['press/娱乐春秋/'])
    })

    it('回收站不可用时降级永久删除，仍清理索引并回传 permanent', async () => {
        const { indexer, removed } = createIndexer()
        const projectPath = path.join(STORAGE_ROOT, 'press', '娱乐春秋')
        setDirectory(projectPath)
        setFileContent(path.join(projectPath, 'README.md'), '# 娱乐春秋')
        setTrashAvailable(false)

        const outcome = await deleteProject(indexer, { dirPath: 'press/娱乐春秋' })

        expect(outcome).toBe('permanent')
        expect(readDeletedPaths()).toEqual([projectPath])
        expect(readFileContent(path.join(projectPath, 'README.md'))).toBeUndefined()
        expect(removed).toEqual(['press/娱乐春秋/'])
    })

    it('作品不存在时报错，不产生删除调用', async () => {
        const { indexer, removed } = createIndexer()

        await expect(deleteProject(indexer, { dirPath: 'press/娱乐春秋' })).rejects.toThrow('作品不存在')
        expect(readDeletedPaths()).toEqual([])
        expect(removed).toEqual([])
    })
})

describe('deleteChapter', () => {
    it('删除分卷章节：文档移入回收站并按完整路径清理索引', async () => {
        const { indexer, removedFiles } = createIndexer()
        const chapterPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '01-初遇.md')
        setFileContent(chapterPath, '# 初遇')

        await deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/剑来/Chapter/01-卷1/01-初遇.md' })

        expect(readDeletedPaths()).toEqual([chapterPath])
        expect(removedFiles).toEqual(['press/剑来/Chapter/01-卷1/01-初遇.md'])
        expect(readFileContent(chapterPath)).toBeUndefined()
    })

    it('未分卷散章同样可删', async () => {
        const { indexer, removedFiles } = createIndexer()
        const chapterPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-初见.md')
        setFileContent(chapterPath, '# 初见')

        await deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/剑来/Chapter/01-初见.md' })

        expect(readDeletedPaths()).toEqual([chapterPath])
        expect(removedFiles).toEqual(['press/剑来/Chapter/01-初见.md'])
    })

    it('章节不存在时报错，不产生删除调用', async () => {
        const { indexer, removedFiles } = createIndexer()

        await expect(
            deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/剑来/Chapter/01-卷1/01-初遇.md' }),
        ).rejects.toThrow('章节不存在')
        expect(readDeletedPaths()).toEqual([])
        expect(removedFiles).toEqual([])
    })

    it('拒绝非 Chapter 层级、跨作品与越界路径', async () => {
        const { indexer } = createIndexer()

        await expect(deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/剑来/README.md' })).rejects.toThrow(
            '章节路径非法',
        )
        await expect(
            deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/雪中/Chapter/01-卷1/01-初遇.md' }),
        ).rejects.toThrow('章节路径非法')
        await expect(
            deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/../x/Chapter/a.md' }),
        ).rejects.toThrow('章节路径非法')
        expect(readDeletedPaths()).toEqual([])
    })

    it('文档有未保存修改时拒绝删除，磁盘文件保留', async () => {
        const { indexer, removedFiles } = createIndexer()
        const chapterPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '01-初遇.md')
        setFileContent(chapterPath, '# 初遇')
        registerDirtyTextDocument(chapterPath, ['# 初遇（未保存）'])

        await expect(
            deleteChapter(indexer, { dirPath: 'press/剑来', path: 'press/剑来/Chapter/01-卷1/01-初遇.md' }),
        ).rejects.toThrow('章节有未保存的修改')
        expect(readDeletedPaths()).toEqual([])
        expect(removedFiles).toEqual([])
        expect(readFileContent(chapterPath)).toBe('# 初遇')
    })
})

describe('moveChapter', () => {
    it('移动到目标卷末尾：按目标卷重排序号，先清旧记录再索引新路径', async () => {
        const { indexer, indexed, removedFiles } = createIndexer()
        const sourcePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '03-初见.md')
        setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '02-卷2'))
        setFileContent(sourcePath, '# 初见')

        const moved = await moveChapter(indexer, {
            dirPath: 'press/剑来',
            path: 'press/剑来/Chapter/01-卷1/03-初见.md',
            targetVolumeDir: '02-卷2',
            chapterPaths: [
                'press/剑来/Chapter/01-卷1/03-初见.md',
                'press/剑来/Chapter/02-卷2/04-远行.md',
                'press/剑来/Chapter/02-卷2/07-重逢.md',
            ],
        })

        const targetPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '02-卷2', '08-初见.md')
        expect(moved.path).toBe('press/剑来/Chapter/02-卷2/08-初见.md')
        expect(moved.title).toBe('初见')
        expect(moved.volume).toBe('卷2')
        expect(moved.uri.fsPath).toBe(targetPath)
        expect(readFileContent(targetPath)).toBe('# 初见')
        expect(readFileContent(sourcePath)).toBeUndefined()
        expect(removedFiles).toEqual(['press/剑来/Chapter/01-卷1/03-初见.md'])
        expect(indexed).toEqual([targetPath])
    })

    it('移动到未分卷根目录时沿用 Chapter/ 下的下一序号', async () => {
        const { indexer } = createIndexer()
        const sourcePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '03-初见.md')
        setFileContent(sourcePath, '# 初见')

        const moved = await moveChapter(indexer, {
            dirPath: 'press/剑来',
            path: 'press/剑来/Chapter/01-卷1/03-初见.md',
            targetVolumeDir: '',
            chapterPaths: ['press/剑来/Chapter/01-卷1/03-初见.md', 'press/剑来/Chapter/02-旧章.md'],
        })

        expect(moved.path).toBe('press/剑来/Chapter/03-初见.md')
        expect(moved.volume).toBe('')
    })

    it('目标文件名已存在时递增序号且不覆盖', async () => {
        const { indexer } = createIndexer()
        const sourcePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '03-初见.md')
        const occupiedPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '02-卷2', '01-初见.md')
        setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '02-卷2'))
        setFileContent(sourcePath, '# 初见')
        setFileContent(occupiedPath, '占位内容')

        const moved = await moveChapter(indexer, {
            dirPath: 'press/剑来',
            path: 'press/剑来/Chapter/01-卷1/03-初见.md',
            targetVolumeDir: '02-卷2',
            chapterPaths: ['press/剑来/Chapter/01-卷1/03-初见.md'],
        })

        expect(moved.path).toBe('press/剑来/Chapter/02-卷2/02-初见.md')
        expect(readFileContent(occupiedPath)).toBe('占位内容')
    })

    it('目标卷不存在时拒绝，源文件保留', async () => {
        const { indexer, indexed } = createIndexer()
        const sourcePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '03-初见.md')
        setFileContent(sourcePath, '# 初见')

        await expect(
            moveChapter(indexer, {
                dirPath: 'press/剑来',
                path: 'press/剑来/Chapter/01-卷1/03-初见.md',
                targetVolumeDir: '09-卷9',
                chapterPaths: [],
            }),
        ).rejects.toThrow('目标卷不存在：09-卷9')
        expect(readFileContent(sourcePath)).toBe('# 初见')
        expect(indexed).toEqual([])
    })

    it('同卷移动时拒绝', async () => {
        const { indexer, indexed } = createIndexer()
        const sourcePath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-卷1', '03-初见.md')
        setFileContent(sourcePath, '# 初见')

        await expect(
            moveChapter(indexer, {
                dirPath: 'press/剑来',
                path: 'press/剑来/Chapter/01-卷1/03-初见.md',
                targetVolumeDir: '01-卷1',
                chapterPaths: [],
            }),
        ).rejects.toThrow('章节已在该卷：卷1')
        expect(indexed).toEqual([])
    })

    it('章节路径非法时拒绝，不触达文件系统', async () => {
        const { indexer } = createIndexer()

        await expect(
            moveChapter(indexer, {
                dirPath: 'press/剑来',
                path: 'press/剑来/README.md',
                targetVolumeDir: '02-卷2',
                chapterPaths: [],
            }),
        ).rejects.toThrow('章节路径非法')
    })
})
