/**
 * 菜单内容纯函数测试：切换类型不残留旧字段，完整性判定与宿主收窄口径一致。
 * 纯函数无外部依赖，直接逐项锁住四种类型的边界，避免编辑对话框与保存校验各写一套。
 */
import { describe, expect, it } from 'vitest'
import { createMenuContent, isMenuContentComplete } from '../src/workflow/wechat/menu/utils/menuContent'

describe('createMenuContent', () => {
    it('图片类型只带素材必填字段', () => {
        expect(createMenuContent('image')).toEqual({ kind: 'image', materialId: '', mediaId: '', url: '' })
    })

    it('图文类型只带批次与发布 id 必填字段', () => {
        expect(createMenuContent('news')).toEqual({ kind: 'news', issueId: '', articleId: '', title: '' })
    })

    it('链接类型只带空链接地址', () => {
        expect(createMenuContent('link')).toEqual({ kind: 'link', linkUrl: '' })
    })

    it('小程序类型只带 appid、页面路径与兜底网页', () => {
        expect(createMenuContent('miniprogram')).toEqual({
            kind: 'miniprogram',
            appid: '',
            pagepath: '',
            miniUrl: '',
        })
    })
})

describe('isMenuContentComplete', () => {
    it('图片必须同时有素材 id、mediaId 与地址', () => {
        expect(isMenuContentComplete({ kind: 'image', materialId: 'm', mediaId: 'x' })).toBe(false)
        expect(
            isMenuContentComplete({ kind: 'image', materialId: 'm', mediaId: 'x', url: 'https://img.example/1.png' }),
        ).toBe(true)
    })

    it('图文必须同时有批次 id、发布 articleId 与标题', () => {
        expect(isMenuContentComplete({ kind: 'news', issueId: 'i', title: '标题' })).toBe(false)
        expect(isMenuContentComplete({ kind: 'news', issueId: 'i', articleId: 'a', title: '标题' })).toBe(true)
    })

    it('链接必须是合法的 http/https 地址', () => {
        expect(isMenuContentComplete({ kind: 'link', linkUrl: '' })).toBe(false)
        expect(isMenuContentComplete({ kind: 'link', linkUrl: 'javascript:alert(1)' })).toBe(false)
        expect(isMenuContentComplete({ kind: 'link', linkUrl: 'https://example.com' })).toBe(true)
    })

    it('小程序必须同时有 appid、页面路径与合法兜底网页', () => {
        expect(isMenuContentComplete({ kind: 'miniprogram', appid: 'wx1', pagepath: 'pages/index' })).toBe(false)
        expect(
            isMenuContentComplete({
                kind: 'miniprogram',
                appid: 'wx1',
                pagepath: 'pages/index',
                miniUrl: 'javascript:alert(1)',
            }),
        ).toBe(false)
        expect(
            isMenuContentComplete({
                kind: 'miniprogram',
                appid: 'wx1',
                pagepath: 'pages/index',
                miniUrl: 'https://example.com',
            }),
        ).toBe(true)
    })
})
