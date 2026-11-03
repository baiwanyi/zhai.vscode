/**
 * 在线图库命名的单元测试：覆盖年月目录、上游文件名保留与非法标识拦截。
 * 纯函数测试，不读盘、不联网；Uri 由测试桩构造，路径期望值一律用 path.join 拼装，
 * 避免 Windows 与 POSIX 的分隔符差异让结论随平台漂移。
 */
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import {
    buildStockTarget,
    formatMonthDir,
    normalizeStockExtension,
    readStockMonth,
    toStockRefPath,
} from '../src/modules/stock/stockNaming'

/** 存储根：固定绝对路径作基准 */
const ROOT = vscode.Uri.file(path.resolve('/tmp/zhai-root'))
/** 落盘时刻：本地时区 2026-11-03 15:30:45 */
const AT = new Date(2026, 10, 3, 15, 30, 45)

describe('buildStockTarget', () => {
    it('按年月目录与上游文件名生成目标，不拼时间戳', () => {
        const target = buildStockTarget(ROOT, 'Kq2WnB6x9eA', 'jpg', AT)
        expect(target.relPath).toBe('unsplash/202611/Kq2WnB6x9eA.jpg')
        expect(target.fileName).toBe('Kq2WnB6x9eA.jpg')
        expect(target.month).toBe('2026-11')
        expect(target.monthDir).toBe('202611')
        expect(target.dirUri.fsPath).toBe(path.join(ROOT.fsPath, 'unsplash/202611'))
    })

    it('扩展名归一后再落盘：jpeg 记为 jpg，未知类型回落 jpg', () => {
        expect(buildStockTarget(ROOT, 'Kq2WnB6x9eA', '.JPEG', AT).relPath).toBe('unsplash/202611/Kq2WnB6x9eA.jpg')
        expect(buildStockTarget(ROOT, 'Kq2WnB6x9eA', 'exe', AT).relPath).toBe('unsplash/202611/Kq2WnB6x9eA.jpg')
        expect(buildStockTarget(ROOT, 'Kq2WnB6x9eA', 'webp', AT).relPath).toBe('unsplash/202611/Kq2WnB6x9eA.webp')
    })

    it('非法标识一律拒绝，不进入路径拼装', () => {
        expect(() => buildStockTarget(ROOT, '../evil', 'jpg', AT)).toThrow('图片标识非法')
        expect(() => buildStockTarget(ROOT, 'a/b', 'jpg', AT)).toThrow('图片标识非法')
        expect(() => buildStockTarget(ROOT, '', 'jpg', AT)).toThrow('图片标识非法')
    })
})

describe('readStockMonth', () => {
    it('从存储根相对路径取年月', () => {
        expect(readStockMonth('unsplash/202611/Kq2WnB6x9eA.jpg')).toBe('2026-11')
    })

    it('层级不符或年月非六位数字时返回 null', () => {
        expect(readStockMonth('unsplash/a.jpg')).toBeNull()
        expect(readStockMonth('unsplash/26/Kq2WnB6x9eA.jpg')).toBeNull()
        expect(readStockMonth('images/202611/Kq2WnB6x9eA.jpg')).toBeNull()
    })
})

describe('toStockRefPath', () => {
    it('拼成 @zhai/ 存储根引用', () => {
        expect(toStockRefPath('unsplash/202611/Kq2WnB6x9eA.jpg')).toBe('@zhai/unsplash/202611/Kq2WnB6x9eA.jpg')
    })
})

describe('normalizeStockExtension 与 formatMonthDir', () => {
    it('扩展名去点、小写并收敛别名', () => {
        expect(normalizeStockExtension('.PNG')).toBe('png')
        expect(normalizeStockExtension('jpeg')).toBe('jpg')
        expect(normalizeStockExtension('gif')).toBe('gif')
    })

    it('年月目录补零到两位', () => {
        expect(formatMonthDir(new Date(2026, 0, 5))).toBe('202601')
        expect(formatMonthDir(new Date(2026, 11, 31))).toBe('202612')
    })
})
