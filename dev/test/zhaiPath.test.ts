/**
 * @zhai/ 路径解析用例：覆盖前缀判定、越界拒绝、基址拼接与两个渲染环节的地址形态。
 * 复用约定：纯函数部分直接断言，预览侧调用 resolvePreviewSrc 并借助 vscode 测试桩提供存储根配置。
 * 关键约束：`..`、空段、反斜杠与盘符必须被拒绝，否则文档可以借此读到存储根之外的文件；
 * 基址末尾斜杠的有无不能影响结果，否则 webview 里会出现 `//` 或缺失分隔符。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue } from './stubs/vscode'
import { resolvePreviewSrc } from '../../src/modules/markdown/zhaiImagePreview'
import { isZhaiPath, joinStorageBase, readZhaiRelativePath, resolveZhaiSrc } from '../../src/shared/utils/zhaiPath'

const STORAGE_ROOT = 'd:/vault'
const IMAGE = '@zhai/images/202610/20261023214848e3g8VP.png'

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('前缀判定', () => {
    it('识别 @zhai/ 开头的路径', () => {
        expect(isZhaiPath(IMAGE)).toBe(true)
    })

    it('缺少斜杠或大小写不符时不识别', () => {
        expect(isZhaiPath('@zhai')).toBe(false)
        expect(isZhaiPath('@ZHAI/images/a.png')).toBe(false)
        expect(isZhaiPath('images/202610/a.png')).toBe(false)
        expect(isZhaiPath('https://example.com/a.png')).toBe(false)
    })
})

describe('相对路径提取', () => {
    it('去掉前缀并保留子目录与文件名', () => {
        expect(readZhaiRelativePath(IMAGE)).toBe('images/202610/20261023214848e3g8VP.png')
    })

    it('拒绝越出存储根的 .. 段', () => {
        expect(readZhaiRelativePath('@zhai/../secret.png')).toBeNull()
        expect(readZhaiRelativePath('@zhai/images/../../secret.png')).toBeNull()
        expect(readZhaiRelativePath('@zhai/images/./a.png')).toBeNull()
    })

    it('拒绝空段、反斜杠与盘符', () => {
        expect(readZhaiRelativePath('@zhai/')).toBeNull()
        expect(readZhaiRelativePath('@zhai//images/a.png')).toBeNull()
        expect(readZhaiRelativePath('@zhai/images\\a.png')).toBeNull()
        expect(readZhaiRelativePath('@zhai/c:/images/a.png')).toBeNull()
    })

    it('剥离查询串与锚点', () => {
        expect(readZhaiRelativePath('@zhai/images/a.png?v=1')).toBe('images/a.png')
        expect(readZhaiRelativePath('@zhai/images/a.png#top')).toBe('images/a.png')
    })
})

describe('基址拼接', () => {
    it('基址没有末尾斜杠时补一个分隔符', () => {
        expect(joinStorageBase('https://host/root', 'images/a.png')).toBe('https://host/root/images/a.png')
    })

    it('基址带多个末尾斜杠时只保留一个分隔符', () => {
        expect(joinStorageBase('https://host/root///', 'images/a.png')).toBe('https://host/root/images/a.png')
    })

    it('相对路径带前导斜杠时不再叠加分隔符', () => {
        expect(joinStorageBase('https://host/root', '/images/a.png')).toBe('https://host/root/images/a.png')
    })

    it('基址为空时直接返回相对路径', () => {
        expect(joinStorageBase('', 'images/a.png')).toBe('images/a.png')
    })
})

describe('图片地址解析', () => {
    it('命中前缀时拼到基址', () => {
        expect(resolveZhaiSrc(IMAGE, 'https://host/root')).toBe(
            'https://host/root/images/202610/20261023214848e3g8VP.png',
        )
    })

    it('保留查询串与锚点', () => {
        expect(resolveZhaiSrc('@zhai/images/a.png?v=1', 'https://host/root')).toBe('https://host/root/images/a.png?v=1')
    })

    it('非前缀路径原样返回', () => {
        expect(resolveZhaiSrc('../../../images/a.png', 'https://host/root')).toBe('../../../images/a.png')
        expect(resolveZhaiSrc('https://example.com/a.png', 'https://host/root')).toBe('https://example.com/a.png')
        expect(resolveZhaiSrc('data:image/png;base64,AAA', 'https://host/root')).toBe('data:image/png;base64,AAA')
    })

    it('基址为空时原样返回，避免产出坏链接', () => {
        expect(resolveZhaiSrc(IMAGE, '')).toBe(IMAGE)
    })

    it('越界路径不拼接', () => {
        expect(resolveZhaiSrc('@zhai/../secret.png', 'https://host/root')).toBe('@zhai/../secret.png')
    })
})

describe('预览地址解析', () => {
    it('同一盘符下输出相对当前文档的路径', () => {
        const documentPath = path.join('d:/vault/press/剑来/Chapters', '第1章.md')
        expect(resolvePreviewSrc(IMAGE, documentPath)).toBe('../../../images/202610/20261023214848e3g8VP.png')
    })

    it('跨盘时退回 file:// 绝对地址', () => {
        const documentPath = path.join('c:/elsewhere/notes', '随笔.md')
        const resolved = resolvePreviewSrc(IMAGE, documentPath)
        expect(resolved).not.toBeNull()
        expect(resolved?.startsWith('file:///')).toBe(true)
        expect(resolved).toContain('20261023214848e3g8VP.png')
    })

    it('无当前文档时退回 file:// 绝对地址', () => {
        const resolved = resolvePreviewSrc(IMAGE, undefined)
        expect(resolved?.startsWith('file:///')).toBe(true)
        expect(resolved).toContain('/images/202610/')
    })

    it('非前缀路径返回 null，交由原生渲染处理', () => {
        expect(resolvePreviewSrc('../../../images/a.png', undefined)).toBeNull()
        expect(resolvePreviewSrc('@zhai/../secret.png', undefined)).toBeNull()
    })
})
