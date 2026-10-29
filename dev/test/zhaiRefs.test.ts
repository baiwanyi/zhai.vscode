/**
 * 对话框 @zhai 引用展开用例：覆盖正反斜杠识别、行号保留、目录命中，以及越界 / 盘符 / 目标缺失时的原样保留。
 * 复用约定：存储根由配置桩提供，存在性登记在虚拟磁盘（workspace.fs.stat），不读真实文件。
 * 关键约束：任何解析失败都不得产出存储根之外的绝对路径，否则模型会拿着越界路径去触发工具校验。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createUri, resetWorkspaceState, setConfigValue, setFileContent, workspace } from './stubs/vscode'
import { expandZhaiRefs } from '../../src/modules/ai/zhaiRefs'

const ROOT = 'd:/vault'
const CHAPTER = 'press/123/Chapters/01-默认卷/04-未命名章节.md'

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', ROOT)
})

describe('@zhai 引用展开', () => {
    it('反斜杠路径展开为绝对路径并保留行号', async () => {
        setFileContent(path.join(ROOT, CHAPTER), '正文')
        const text = '@zhai\\press\\123\\Chapters\\01-默认卷\\04-未命名章节.md:42 这一行'
        expect(await expandZhaiRefs(text)).toBe(`${path.join(ROOT, CHAPTER)}:42 这一行`)
    })

    it('正斜杠写法同样命中', async () => {
        setFileContent(path.join(ROOT, CHAPTER), '正文')
        expect(await expandZhaiRefs('@zhai/press/123/Chapters/01-默认卷/04-未命名章节.md')).toBe(
            path.join(ROOT, CHAPTER),
        )
    })

    it('行范围后缀原样保留', async () => {
        setFileContent(path.join(ROOT, CHAPTER), '正文')
        expect(await expandZhaiRefs('@zhai/press/123/Chapters/01-默认卷/04-未命名章节.md:42-50')).toBe(
            `${path.join(ROOT, CHAPTER)}:42-50`,
        )
    })

    it('目录同样展开，供模型自行浏览', async () => {
        await workspace.fs.createDirectory(createUri(path.join(ROOT, 'press/123/Chapters')))
        expect(await expandZhaiRefs('@zhai\\press\\123\\Chapters')).toBe(path.join(ROOT, 'press/123/Chapters'))
    })

    it('目标不存在时原样保留', async () => {
        expect(await expandZhaiRefs('@zhai/press/123/missing.md')).toBe('@zhai/press/123/missing.md')
    })

    it('越界与盘符写法原样保留', async () => {
        const text = '@zhai/../secret.md 与 @zhai/c:/windows/win.ini'
        expect(await expandZhaiRefs(text)).toBe(text)
    })

    it('中文标点不被吞进路径', async () => {
        setFileContent(path.join(ROOT, CHAPTER), '正文')
        const text = '@zhai/press/123/Chapters/01-默认卷/04-未命名章节.md，先看这段'
        expect(await expandZhaiRefs(text)).toBe(`${path.join(ROOT, CHAPTER)}，先看这段`)
    })

    it('没有令牌时原样返回', async () => {
        expect(await expandZhaiRefs('普通提问，不含引用')).toBe('普通提问，不含引用')
    })
})
