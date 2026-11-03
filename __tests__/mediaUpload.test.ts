/**
 * 媒体上传单元测试：覆盖 base64 解析与校验、data URL 前缀兼容、魔数嗅探落盘与非图片拒绝。
 * 磁盘与配置由 vscode 测试桩承接，命名由 mediaNaming 真实产出，断言的是实际写入路径。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createUri, readFileContent, resetWorkspaceState } from './stubs/vscode'
import { parseUploadItem, saveUploadedImage } from '../src/modules/media/mediaUpload'

const STORAGE_ROOT = 'd:/vault'
/** 最小 PNG 头：嗅探只看前 8 字节 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64')

beforeEach(() => {
    resetWorkspaceState()
})

describe('parseUploadItem', () => {
    it('接受纯 base64 并解出原始字节', () => {
        const result = parseUploadItem({ name: 'a.png', dataBase64: PNG_BASE64 })

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.candidate.name).toBe('a.png')
            expect([...result.candidate.bytes]).toEqual([...PNG_BYTES])
        }
    })

    it('兼容 FileReader 产出的 data URL 前缀', () => {
        const result = parseUploadItem({ name: 'a.png', dataBase64: `data:image/png;base64,${PNG_BASE64}` })

        expect(result.ok).toBe(true)
    })

    it('缺少内容时按项拒绝并给出原因', () => {
        const result = parseUploadItem({ name: 'a.png' })

        expect(result).toMatchObject({ ok: false, name: 'a.png', reason: '缺少图片内容' })
    })

    it('非法 base64 被拒绝', () => {
        const result = parseUploadItem({ name: 'a.png', dataBase64: '不是 base64!!' })

        expect(result.ok).toBe(false)
    })
})

describe('saveUploadedImage', () => {
    it('按魔数决定扩展名，落盘到 images/{YYYYMM}/{id}.png', async () => {
        const file = await saveUploadedImage(createUri(STORAGE_ROOT), PNG_BYTES)

        expect(file.ext).toBe('png')
        expect(file.id).toMatch(/^\d{14}[A-Z0-9]{6}$/)
        expect(file.path).toBe(`images/${file.id.slice(0, 6)}/${file.id}.png`)
        expect(readFileContent(path.join(STORAGE_ROOT, ...file.path.split('/')))).toBeDefined()
    })

    it('非图片字节被拒绝，不产生任何落盘', async () => {
        const text = new TextEncoder().encode('hello')

        await expect(saveUploadedImage(createUri(STORAGE_ROOT), text)).rejects.toThrow('无法识别的图片格式')
    })
})
