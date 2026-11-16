/**
 * dashboardRouting 单元测试：覆盖页内路由的解析、作品详情路径编解码、公众号文档归属与回退规则。
 * 纯函数测试，不依赖 DOM 与宿主协议；断言集中在可识别路径、非法编码与 hash 生成三处。
 */
import { describe, expect, it } from 'vitest'
import {
    parseRoute,
    readDashboardScope,
    readWechatAppId,
    shouldFallbackToHome,
    toHash,
} from '../src/dashboard/core/routing'

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

    it('识别公众号列表页与账号页', () => {
        expect(parseRoute('#/wechat')).toEqual({ name: 'wechat' })
        expect(parseRoute('#/wechat/acc-1a2b3c4d5e')).toEqual({
            name: 'wechatAccount',
            accountId: 'acc-1a2b3c4d5e',
        })
    })

    it('未登记路径与多余层级回落首页', () => {
        expect(parseRoute('#/unknown')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/a/b')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/')).toEqual({ name: 'home' })
        expect(parseRoute('#/wechat/')).toEqual({ name: 'home' })
        expect(parseRoute('#/wechat/a/b')).toEqual({ name: 'home' })
    })

    it('公众号账号页的非法 id 回落首页', () => {
        expect(parseRoute('#/wechat/..')).toEqual({ name: 'home' })
        expect(parseRoute('#/wechat/ACC-1')).toEqual({ name: 'home' })
        expect(parseRoute('#/wechat/%E4%B8')).toEqual({ name: 'home' })
    })

    it('非法编码与越界片段回落首页', () => {
        expect(parseRoute('#/press/%E4%B8')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/a%2Fb')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/%2E%2E')).toEqual({ name: 'home' })
        expect(parseRoute('#/press/%5C')).toEqual({ name: 'home' })
    })
})

describe('readWechatAppId', () => {
    it('批次目录下的文档能解析出账号 AppID', () => {
        expect(readWechatAppId('wechat/wx1234567890/post/202611021530/标题.md')).toBe('wx1234567890')
    })

    it('只有 wechat/ 一级目录不算批次文档', () => {
        expect(readWechatAppId('wechat/wx1234567890/settings.json')).toBeNull()
        expect(readWechatAppId('wechat/wx1234567890/post')).toBeNull()
        expect(readWechatAppId('wechat/wx1234567890/posts/202611021530/a.md')).toBeNull()
    })

    it('非公众号路径与空值一律返回 null', () => {
        expect(readWechatAppId(null)).toBeNull()
        expect(readWechatAppId('notes/202611/随手记.md')).toBeNull()
        expect(readWechatAppId('press/剑来/Chapters/01-开局.md')).toBeNull()
    })
})

describe('readDashboardScope', () => {
    it('作品归属优先于文档一级目录', () => {
        expect(readDashboardScope('notes/202611/随手记.md', 'press/剑来', true)).toBe('press')
    })

    it('按文档一级目录判定笔记与公众号归属', () => {
        expect(readDashboardScope('notes/202611/随手记.md', null, true)).toBe('note')
        expect(readDashboardScope('wechat/wx1234567890/post/202611021530/a.md', null, true)).toBe('wechat')
        expect(readDashboardScope('press/剑来/Chapters/01-开局.md', null, true)).toBe('press')
    })

    it('焦点不在编辑器时无从判定，索引外文档视为无归属', () => {
        expect(readDashboardScope('notes/202611/随手记.md', null, false)).toBeUndefined()
        expect(readDashboardScope(null, null, true)).toBeNull()
        expect(readDashboardScope('README.md', null, true)).toBeNull()
    })
})

describe('shouldFallbackToHome', () => {
    it('归属从作品切到笔记或未知文档且不在首页时回首页', () => {
        expect(shouldFallbackToHome('note', 'press', 'pressProject')).toBe(true)
        expect(shouldFallbackToHome(null, 'press', 'wechatAccount')).toBe(true)
    })

    it('已在首页或归属未变化时不导航', () => {
        expect(shouldFallbackToHome('note', 'press', 'home')).toBe(false)
        expect(shouldFallbackToHome('note', 'note', 'pressProject')).toBe(false)
    })

    it('作品与公众号归属交由各自的跟随逻辑处理', () => {
        expect(shouldFallbackToHome('press', 'note', 'wechat')).toBe(false)
        expect(shouldFallbackToHome('wechat', 'note', 'press')).toBe(false)
    })

    it('无从判定（焦点不在编辑器）时保持当前页', () => {
        expect(shouldFallbackToHome(undefined, 'press', 'pressProject')).toBe(false)
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
        expect(toHash({ name: 'wechat' })).toBe('#/wechat')
        expect(toHash({ name: 'wechatAccount', accountId: 'acc-1a2b3c4d5e' })).toBe('#/wechat/acc-1a2b3c4d5e')
        expect(parseRoute(toHash({ name: 'wechatAccount', accountId: 'acc-1a2b3c4d5e' }))).toEqual({
            name: 'wechatAccount',
            accountId: 'acc-1a2b3c4d5e',
        })
    })
})
