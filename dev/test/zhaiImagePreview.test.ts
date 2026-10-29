/**
 * Markdown 预览图片插件的用例：验证 `@zhai/` 引用在内置预览里的地址改写。
 * 复用约定：存储根走 vscode 配置桩，图片写在真实临时目录（插件同步读盘，虚拟磁盘桩接不住）；
 * 关键约束：预览 webview 只放行工作区与文档目录内的资源，小图必须内联成 data URI 才能显示，
 * 超大图与未知扩展名退回相对路径、跨盘退回 file://，文件变化后必须重新生成而不是复用缓存。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue } from './stubs/vscode'
import type { MarkdownItLike } from '../../src/modules/markdown/zhaiImagePreview'
import { MAX_INLINE_BYTES, resolvePreviewSrc, zhaiImagePathPlugin } from '../../src/modules/markdown/zhaiImagePreview'

let root = ''
let imageDir = ''

/** 写入一张图片：返回绝对路径，内容由用例决定 */
function writeImage(name: string, content: Buffer): string {
    const target = path.join(imageDir, name)
    fs.writeFileSync(target, content)
    return target
}

/** 存储根内的章节文档：与图片同盘，可相对化 */
function chapterPath(): string {
    return path.join(root, 'press', '剑来', 'Chapters', '第1章.md')
}

/** 最小 token 替身：只实现插件用到的两个属性读写 */
function createToken(initialSrc: string): {
    attrGet(name: string): string | null
    attrSet(name: string, value: string): void
} {
    let current = initialSrc
    return {
        attrGet: (name: string): string | null => (name === 'src' ? current : null),
        attrSet: (name: string, value: string): void => {
            if (name === 'src') {
                current = value
            }
        },
    }
}

/** 最小 markdown-it 替身：原样回显 src，便于断言插件改写结果 */
function createMarkdown(): MarkdownItLike {
    return {
        renderer: {
            rules: {
                image: (tokens, idx): string => `<img src="${tokens[idx]?.attrGet('src') ?? ''}">`,
            },
            renderToken: (): string => '<img>',
        },
    }
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhai-preview-'))
    imageDir = path.join(root, 'images', '202610')
    fs.mkdirSync(imageDir, { recursive: true })
})

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', root)
})

describe('resolvePreviewSrc', () => {
    it('小图内联为 data URI，绕开预览资源白名单', () => {
        const content = Buffer.from('fake-png')
        writeImage('small.png', content)

        const result = resolvePreviewSrc('@zhai/images/202610/small.png', chapterPath())

        expect(result).toBe(`data:image/png;base64,${content.toString('base64')}`)
    })

    it('超过内联上限退回相对路径', () => {
        writeImage('big.png', Buffer.alloc(MAX_INLINE_BYTES + 1))

        const result = resolvePreviewSrc('@zhai/images/202610/big.png', chapterPath())

        expect(result).toBe('../../../images/202610/big.png')
    })

    it('扩展名不认识时不内联', () => {
        writeImage('scan.tiff', Buffer.from('tiff'))

        const result = resolvePreviewSrc('@zhai/images/202610/scan.tiff', chapterPath())

        expect(result).toBe('../../../images/202610/scan.tiff')
    })

    it('文件不存在时同盘退回相对路径，跨盘退回 file://', () => {
        expect(resolvePreviewSrc('@zhai/images/202610/missing.png', chapterPath())).toBe(
            '../../../images/202610/missing.png',
        )
        expect(resolvePreviewSrc('@zhai/images/202610/missing.png', path.join('x:/outside', 'note.md'))).toMatch(
            /^file:\/\/\//u,
        )
    })

    it('非 @zhai/ 引用不处理', () => {
        expect(resolvePreviewSrc('https://example.com/a.png', chapterPath())).toBeNull()
        expect(resolvePreviewSrc('./local.png', chapterPath())).toBeNull()
    })

    it('文件内容变化后重新内联，不复用旧缓存', () => {
        writeImage('cache.png', Buffer.from('v1'))
        const first = resolvePreviewSrc('@zhai/images/202610/cache.png', chapterPath())

        const content = Buffer.from('version-2-longer')
        writeImage('cache.png', content)
        const second = resolvePreviewSrc('@zhai/images/202610/cache.png', chapterPath())

        expect(second).not.toBe(first)
        expect(second).toBe(`data:image/png;base64,${content.toString('base64')}`)
    })
})

describe('zhaiImagePathPlugin', () => {
    it('命中前缀改写 src，未命中保持原值', () => {
        const content = Buffer.from('fake-png')
        writeImage('plug.png', content)
        const md = createMarkdown()
        zhaiImagePathPlugin(md)

        const zhaiToken = createToken('@zhai/images/202610/plug.png')
        md.renderer.rules.image?.([zhaiToken], 0, {}, {}, md.renderer)
        expect(zhaiToken.attrGet('src')).toBe(`data:image/png;base64,${content.toString('base64')}`)

        const plainToken = createToken('https://example.com/a.png')
        md.renderer.rules.image?.([plainToken], 0, {}, {}, md.renderer)
        expect(plainToken.attrGet('src')).toBe('https://example.com/a.png')
    })
})
