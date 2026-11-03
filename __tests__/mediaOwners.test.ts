/**
 * 媒体关联归属单元测试：覆盖作品按作品名聚合、笔记精确到篇、公众号精确到批次、
 * 存储根外文档兜底与类型排序。
 */
import { describe, expect, it } from 'vitest'
import type { MediaUsageItem } from '../src/shared/types/media'
import { groupOwners } from '../src/modules/media/mediaOwners'

/** 构造一条引用：默认是一篇作品章节，用例按需覆盖 */
function usage(overrides: Partial<MediaUsageItem>): MediaUsageItem {
    return {
        refType: 'chapter',
        refPath: 'press/剑来/Chapters/01-雪夜.md',
        refScope: 'storage',
        refId: null,
        refTitle: '雪夜',
        refAnchor: null,
        seenAt: '2026-11-03T00:00:00.000Z',
        ...overrides,
    }
}

describe('groupOwners', () => {
    it('同一作品的章节与封面合并成一条，展示作品名', () => {
        const owners = groupOwners([
            usage({}),
            usage({ refPath: 'press/剑来/Chapters/02-春分.md', refTitle: '春分' }),
            usage({ refType: 'press_cover', refPath: 'press/剑来', refTitle: '剑来' }),
        ])

        expect(owners).toHaveLength(1)
        expect(owners[0]).toMatchObject({ type: 'press', id: 'press/剑来', label: '剑来', refCount: 3 })
    })

    it('笔记精确到某一篇，展示笔记标题', () => {
        const owners = groupOwners([
            usage({ refType: 'note', refPath: 'notes/202611/周会纪要.md', refTitle: '周会纪要' }),
            usage({ refType: 'note', refPath: 'notes/202611/另一篇.md', refTitle: '另一篇' }),
        ])

        expect(owners.map((owner) => owner.label)).toEqual(['周会纪要', '另一篇'])
        expect(owners[0]?.id).toBe('notes/202611/周会纪要.md')
    })

    it('公众号按批次聚合，不按单篇文章', () => {
        const owners = groupOwners([
            usage({ refType: 'article', refPath: 'wechat/wx123/post/20261103/a.md', refTitle: 'A' }),
            usage({ refType: 'article', refPath: 'wechat/wx123/post/20261103/b.md', refTitle: 'B' }),
            usage({ refType: 'article', refPath: 'wechat/wx123/post/20261020/c.md', refTitle: 'C' }),
        ])

        expect(owners).toHaveLength(2)
        expect(owners[0]).toMatchObject({ type: 'wechat', id: 'wechat/wx123/post/20261103', refCount: 2 })
        expect(owners[0]?.label).toBe('批次 20261103')
    })

    it('存储根外文档单列，整体按 作品 → 笔记 → 公众号 → 文档 排序', () => {
        const owners = groupOwners([
            usage({ refType: 'external', refPath: 'd:/其他/说明.md', refScope: 'absolute', refTitle: '说明' }),
            usage({}),
            usage({ refType: 'note', refPath: 'notes/202611/周会纪要.md', refTitle: '周会纪要' }),
            usage({ refType: 'article', refPath: 'wechat/wx123/post/20261103/a.md', refTitle: 'A' }),
        ])

        expect(owners.map((owner) => owner.type)).toEqual(['press', 'note', 'wechat', 'external'])
    })

    it('没有引用时返回空数组', () => {
        expect(groupOwners([])).toEqual([])
    })
})
