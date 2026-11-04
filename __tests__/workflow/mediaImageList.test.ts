/**
 * 统一图片列表的纯函数用例：年月格式化与选项、按月分组、四类领域条目映射与分组折算。
 * 复用约定：用例只调用 hooks/mediaMonth 与 layout/imageList/imageListAdapters 的纯函数，
 * 领域桩按完整接口构造、不使用类型断言，不依赖 DOM 与 React 渲染。
 * 关键约束：分组键倒序但组内顺序沿用入参，组头计数取组内总数；source 原样保留领域对象，
 * 缺图与非图片文件分别落到各自的占位语义，避免两类占位混用。
 */
import { describe, expect, it } from 'vitest'
import type { MediaItem } from '@shared/types/media'
import type { StockPhoto } from '@shared/types/stock'
import type { UploadFileItem } from '@shared/types/upload'
import { formatMediaMonth, groupByMonth, toMonthOptions } from '@webview/workflow/media/hooks/mediaMonth'
import {
    toImageListGroups,
    toMediaItem,
    toStockPhotoItem,
    toUploadFileItem,
} from '@webview/workflow/media/layout/imageList/imageListAdapters'

function createMedia(overrides: Partial<MediaItem> = {}): MediaItem {
    return {
        id: '20261025143000aB3xK9',
        path: 'images/202610/20261025143000aB3xK9.png',
        url: 'https://example.test/media.png',
        ext: 'png',
        byteSize: 1024,
        month: '2026-10',
        createdAt: '2026-10-25T14:30:00.000Z',
        scope: 'press',
        origin: 'generate',
        kind: 'portrait',
        pressPath: 'press/剑来',
        pressName: '剑来',
        characterId: '10428736',
        characterName: '林清',
        loreKind: null,
        loreId: null,
        loreName: null,
        usageCount: 0,
        missing: false,
        prompt: null,
        ratio: null,
        style: null,
        enhancedFrom: null,
        ...overrides,
    }
}

function createStockPhoto(overrides: Partial<StockPhoto> = {}): StockPhoto {
    return {
        id: 'Kq2WnB6x9eA',
        thumbUrl: 'https://example.test/thumb.jpg',
        width: 1200,
        height: 800,
        alt: '山间薄雾',
        photographer: '张三',
        photographerUrl: 'https://example.test/author',
        downloaded: false,
        ...overrides,
    }
}

function createUpload(overrides: Partial<UploadFileItem> = {}): UploadFileItem {
    return {
        path: 'uploads/202610/20261025143000K3M9QZ.png',
        name: '20261025143000K3M9QZ.png',
        ext: 'png',
        byteSize: 1024,
        month: '2026-10',
        createdAt: '2026-10-25T14:30:00.000Z',
        url: 'https://example.test/upload.png',
        ...overrides,
    }
}

describe('mediaMonth', () => {
    it('年月格式化补中文单位且不补零', () => {
        expect(formatMediaMonth('2026-10')).toBe('2026年10月')
        expect(formatMediaMonth('2026-1')).toBe('2026年1月')
    })

    it('非法年月原样返回，不抛错', () => {
        expect(formatMediaMonth('bad')).toBe('bad')
    })

    it('月份选项以全部月份居首并带总数', () => {
        const options = toMonthOptions([{ month: '2026-10', count: 3 }], 5)

        expect(options).toEqual([
            { value: 'all', label: '全部月份', count: 5 },
            { value: '2026-10', label: '2026年10月', count: 3 },
        ])
    })

    it('分组按月倒序、组内沿用入参顺序且计数取真实条目数', () => {
        const older = createUpload({ path: 'uploads/202609/a.png', month: '2026-09' })
        const newerFirst = createUpload({ path: 'uploads/202610/a.png', month: '2026-10' })
        const newerSecond = createUpload({ path: 'uploads/202610/b.png', month: '2026-10' })

        const groups = groupByMonth([older, newerFirst, newerSecond])

        expect(groups.map((group) => group.month)).toEqual(['2026-10', '2026-09'])
        expect(groups[0]?.label).toBe('2026年10月')
        expect(groups[0]?.total).toBe(2)
        expect(groups[0]?.items.map((item) => item.path)).toEqual([newerFirst.path, newerSecond.path])
    })

    it('空清单不建组', () => {
        expect(groupByMonth([])).toEqual([])
    })
})

describe('imageListAdapters', () => {
    it('媒体条目带出处别名、类型角标与关联徽标，source 原样保留', () => {
        const media = createMedia({ usageCount: 2 })
        const item = toMediaItem(media)

        expect(item.alt).toBe('角色 · 林清')
        expect(item.activateLabel).toBe('查看详情：角色 · 林清')
        expect(item.badges).toContainEqual({ text: '角色', position: 'top-left', variant: 'secondary' })
        expect(item.badges).toContainEqual({ text: '关联 2', position: 'top-right', variant: 'outline' })
        expect(item.source).toBe(media)
    })

    it('丢失的媒体条目只灰显，不会被映射成禁用', () => {
        const item = toMediaItem(createMedia({ missing: true }))

        expect(item.state).toBe('missing')
        expect(item.badges?.[0]?.text).toBe('已丢失')
        expect(item.isDisabled).toBeUndefined()
    })

    it('搜索结果已下载时带角标，缩略图缺失时给缺图占位', () => {
        const downloaded = toStockPhotoItem(createStockPhoto({ downloaded: true }))
        const missing = toStockPhotoItem(createStockPhoto({ thumbUrl: null }))

        expect(downloaded.badges?.[0]?.text).toBe('已下载')
        expect(missing.src).toBeNull()
        expect(missing.fallback?.icon).toBeDefined()
    })

    it('上传条目折算体积文案，非图片文件走文件占位', () => {
        const image = toUploadFileItem(createUpload())
        const document = toUploadFileItem(createUpload({ url: null, ext: 'pdf', byteSize: 512 }))

        expect(image.meta).toBe('1.0 KB')
        expect(image.src).not.toBeNull()
        expect(document.meta).toBe('512 B')
        expect(document.src).toBeNull()
        expect(document.fallback?.label).toBe('pdf')
    })

    it('分组折算保留组头总数并逐条映射', () => {
        const groups = toImageListGroups(groupByMonth([createUpload(), createUpload({ byteSize: 2048 })]), (value) =>
            toUploadFileItem(value),
        )

        expect(groups).toHaveLength(1)
        expect(groups[0]?.key).toBe('2026-10')
        expect(groups[0]?.total).toBe(2)
        expect(groups[0]?.items.map((item) => item.meta)).toEqual(['1.0 KB', '2.0 KB'])
        expect(groups[0]?.items[0]?.source.name).toBe('20261025143000K3M9QZ.png')
    })
})
