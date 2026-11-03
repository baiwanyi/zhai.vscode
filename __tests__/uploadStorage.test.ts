/**
 * 上传单元测试：覆盖 base64 解析与校验、data URL 前缀兼容、扩展名判定与 uploads 目录落盘 / 列举。
 * 磁盘与配置由 vscode 测试桩承接，命名由 mediaNaming 真实产出，断言的是实际写入路径。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createUri, readFileContent, resetWorkspaceState } from './stubs/vscode'
import { parseUploadItem } from '../src/modules/upload/uploadPayload'
import { listUploadFiles, resolveUploadExtension, saveUploadFile } from '../src/modules/upload/uploadStorage'

const STORAGE_ROOT = 'd:/vault'
/** 最小 PNG 头：嗅探只看前 8 字节 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64')
const TEXT_BYTES = new TextEncoder().encode('hello')

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

        expect(result).toMatchObject({ ok: false, name: 'a.png', reason: '缺少文件内容' })
    })

    it('非法 base64 被拒绝', () => {
        const result = parseUploadItem({ name: 'a.png', dataBase64: '不是 base64!!' })

        expect(result.ok).toBe(false)
    })
})

describe('resolveUploadExtension', () => {
    it('图片以魔数为准，忽略原文件名的后缀', () => {
        expect(resolveUploadExtension('a.txt', PNG_BYTES)).toBe('png')
    })

    it('非图片沿用原后缀并转小写', () => {
        expect(resolveUploadExtension('a.TXT', TEXT_BYTES)).toBe('txt')
    })

    it('后缀非法或缺失时回落 bin', () => {
        expect(resolveUploadExtension('无后缀', TEXT_BYTES)).toBe('bin')
        expect(resolveUploadExtension('a.tar.gz', TEXT_BYTES)).toBe('gz')
        expect(resolveUploadExtension('a.备', TEXT_BYTES)).toBe('bin')
    })
})

describe('saveUploadFile', () => {
    it('落盘到 uploads/{YYYYMM}/{14 位时间戳 + 6 位随机码}.png', async () => {
        const file = await saveUploadFile(createUri(STORAGE_ROOT), { name: 'a.png', bytes: PNG_BYTES })

        expect(file.ext).toBe('png')
        expect(file.name).toMatch(/^\d{14}[A-Z0-9]{6}\.png$/u)
        expect(file.path).toBe(`uploads/${file.path.split('/')[1]}/${file.name}`)
        expect(file.path).toMatch(/^uploads\/\d{6}\/\d{14}[A-Z0-9]{6}\.png$/u)
        expect(readFileContent(path.join(STORAGE_ROOT, ...file.path.split('/')))).toBeDefined()
    })

    it('非图片按原后缀落盘', async () => {
        const file = await saveUploadFile(createUri(STORAGE_ROOT), { name: 'a.txt', bytes: TEXT_BYTES })

        expect(file.ext).toBe('txt')
        expect(file.path).toMatch(/^uploads\/\d{6}\/\d{14}[A-Z0-9]{6}\.txt$/u)
    })

    it('同一批落盘互不覆盖', async () => {
        const first = await saveUploadFile(createUri(STORAGE_ROOT), { name: 'a.txt', bytes: TEXT_BYTES })
        const second = await saveUploadFile(createUri(STORAGE_ROOT), { name: 'a.txt', bytes: TEXT_BYTES })

        expect(second.path).not.toBe(first.path)
    })
})

describe('listUploadFiles', () => {
    it('目录不存在时返回空清单', async () => {
        await expect(listUploadFiles(createUri(STORAGE_ROOT))).resolves.toEqual([])
    })

    it('读回已落盘的文件并保留生成名', async () => {
        const file = await saveUploadFile(createUri(STORAGE_ROOT), { name: 'a.png', bytes: PNG_BYTES })

        const items = await listUploadFiles(createUri(STORAGE_ROOT))

        expect(items).toHaveLength(1)
        expect(items[0]?.path).toBe(file.path)
        expect(items[0]?.month).toBe(file.month)
    })
})
