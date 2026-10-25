/**
 * dashboardRouting 单元测试：覆盖页内路由的解析、作品详情路径编解码与回退规则。
 * 纯函数测试，不依赖 DOM 与宿主协议；断言集中在可识别路径、非法编码与 hash 生成三处。
 */
import { describe, expect, it } from 'vitest'
import { parseRoute, toHash } from '../src/dashboard/core/routing'

describe('parseRoute', () => {
    it('空值与首页回落为概览页', () => {
        expect(parseRoute('')).toEqual({ name: 'home' })
        expect(parseRoute('#')).toEqual({ name: 'home' })
        expect(parseRoute('#/')).toEqual({ name: 'home' })
    })

    it('识别已登记的作品列表页', () => {
        expect(parseRoute('#/press')).toEqual({ name: 'press' })
    })

    it('识别作品详情页并还原中文作品名', () => {
        const hash = `#/press/${encodeURIComponent('剑来')}`
        expect(parseRoute(hash)).toEqual({ name: 'pressProject', dirPath: 'press/剑来' })
    })

    it('未登记路径与多余层级回落首页', () => {
        expect(parseRoute('#/unknown')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/a/b')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/')).toEqual({ name: 'home' })
    })

    it('非法编码与越界片段回落首页', () => {
        expect(parseRoute('#/press/%E4%B8')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/a%2Fb')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/%2E%2E')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/%5C')).toEqual({ name: 'home' })
    })
})

describe('toHash', () => {
    it('按路由生成 hash，可被 parseRoute 原样还原', () => {
        expect(toHash({ name: 'home' })).toBe('#/')
        expect(toHash({ name: 'press' })).toBe('#/press')
        expect(toHash({ name: 'pressProject', dirPath: 'press/剑来' })).toBe('#/press/%E5%89%91%E6%9D%A5')
        expect(parseRoute(toHash({ name: 'pressProject', dirPath: 'press/剑来' }))).toEqual({
            name: 'pressProject',
            dirPath: 'press/剑来',
        })
    })
})
