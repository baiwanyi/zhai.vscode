/**
 * dashboardRouting 单元测试：覆盖页内路由的解析与回退规则。
 * 纯函数测试，不依赖 DOM 与宿主协议；断言集中在可识别路径、未知路径与 hash 生成三处。
 */
import { describe, expect, it } from 'vitest'
import { HOME_ROUTE, parseRoute, toHash } from '../webview/dashboard/core/routing'

describe('parseRoute', () => {
    it('识别已登记的写作管理页', () => {
        expect(parseRoute('#/press')).toBe('/press')
    })

    it('空值与首页回落为概览页', () => {
        expect(parseRoute('')).toBe(HOME_ROUTE)
        expect(parseRoute('#')).toBe(HOME_ROUTE)
        expect(parseRoute('#/')).toBe(HOME_ROUTE)
    })

    it('未登记路径一律回落首页', () => {
        expect(parseRoute('#/unknown')).toBe(HOME_ROUTE)
        expect(parseRoute('#/press/extra')).toBe(HOME_ROUTE)
        expect(parseRoute('/press')).toBe('/press')
    })
})

describe('toHash', () => {
    it('按路径生成 hash，可被 parseRoute 原样还原', () => {
        expect(toHash('/press')).toBe('#/press')
        expect(toHash('/')).toBe('#/')
        expect(parseRoute(toHash('/press'))).toBe('/press')
        expect(parseRoute(toHash('/'))).toBe('/')
    })
})
