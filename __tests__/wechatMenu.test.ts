/**
 * 菜单结构校验的单元测试：覆盖数量上限、名称字节上限、四种无回调动作的必填字段与目录节点。
 * 纯函数测试：校验规则是「保存到平台前唯一的口径」，界面与宿主都依赖它，必须逐条锁住。
 * 关注点是「什么会被拒绝」，而不是只验证合法输入能通过；click 等需要回调的动作必须被拒绝。
 */
import { describe, expect, it } from 'vitest'
import { readWechatMenuButtons, WECHAT_MENU_SUB_LIMIT, WECHAT_MENU_TOP_LIMIT } from '../src/shared/types/wechat'

/** 构造一个合法的下发图片按钮 */
function imageButton(name: string): Record<string, unknown> {
    return { id: `id-${name}`, name, type: 'media_id', mediaId: `media-${name}` }
}

/** 构造一个合法的下发图文按钮 */
function newsButton(name: string): Record<string, unknown> {
    return { id: `id-${name}`, name, type: 'article_id', articleId: `article-${name}` }
}

/** 构造一个合法的小程序按钮 */
function miniButton(name: string): Record<string, unknown> {
    return {
        id: `id-${name}`,
        name,
        type: 'miniprogram',
        appid: 'wx123',
        pagepath: 'pages/index/index',
        url: 'https://example.com',
    }
}

describe('readWechatMenuButtons', () => {
    it('接受四种动作的合法菜单（小程序放在二级）', () => {
        const buttons = readWechatMenuButtons([
            imageButton('图片'),
            newsButton('图文'),
            {
                id: 'id-group',
                name: '更多',
                subButton: [
                    { id: 'id-view', name: '官网', type: 'view', url: 'https://example.com' },
                    miniButton('小程序'),
                ],
            },
        ])
        expect(buttons).toHaveLength(3)
        expect(buttons?.[2]?.subButton?.[0]).toEqual({
            id: 'id-view',
            name: '官网',
            type: 'view',
            url: 'https://example.com',
        })
        expect(buttons?.[2]?.subButton?.[1]).toEqual({
            id: 'id-小程序',
            name: '小程序',
            type: 'miniprogram',
            url: 'https://example.com',
            appid: 'wx123',
            pagepath: 'pages/index/index',
        })
    })

    it('拒绝需要回调的动作', () => {
        expect(readWechatMenuButtons([{ id: 'id-1', name: '消息', type: 'click', key: 'K' }])).toBeNull()
        expect(readWechatMenuButtons([{ id: 'id-3', name: '扫码', type: 'scancode_push', key: 'K' }])).toBeNull()
    })

    it('一级超过 3 个直接拒绝', () => {
        const four = Array.from({ length: WECHAT_MENU_TOP_LIMIT + 1 }, (_, index) =>
            imageButton(`菜单${String(index)}`),
        )
        expect(readWechatMenuButtons(four)).toBeNull()
    })

    it('空数组与空名称拒绝', () => {
        expect(readWechatMenuButtons([])).toBeNull()
        expect(readWechatMenuButtons([{ id: 'id-1', name: '   ', type: 'media_id', mediaId: 'M' }])).toBeNull()
    })

    it('一级名称按 UTF-8 字节计：6 个汉字（18 字节）超限', () => {
        expect(readWechatMenuButtons([imageButton('一二三四五')])).not.toBeNull()
        expect(readWechatMenuButtons([imageButton('一二三四五六')])).toBeNull()
    })

    it('目录节点不需要动作字段，二级超过 5 个拒绝', () => {
        const group = { id: 'id-group', name: '更多', subButton: [imageButton('子一'), newsButton('子二')] }
        expect(readWechatMenuButtons([group])).not.toBeNull()

        const tooMany = {
            id: 'id-group-2',
            name: '更多',
            subButton: Array.from({ length: WECHAT_MENU_SUB_LIMIT + 1 }, (_, index) =>
                imageButton(`子${String(index)}`),
            ),
        }
        expect(readWechatMenuButtons([tooMany])).toBeNull()
    })

    it('空目录（subButton 为空数组）拒绝', () => {
        expect(readWechatMenuButtons([{ id: 'id-empty', name: '更多', subButton: [] }])).toBeNull()
    })

    it('二级菜单不允许再嵌套子菜单', () => {
        const nested = {
            id: 'id-group',
            name: '更多',
            subButton: [
                {
                    id: 'id-child',
                    name: '子目录',
                    subButton: [{ id: 'id-grand', name: '孙', type: 'media_id', mediaId: 'M' }],
                },
            ],
        }
        expect(readWechatMenuButtons([nested])).toBeNull()
    })

    it('小程序 appid 必须小写', () => {
        expect(readWechatMenuButtons([{ ...miniButton('小程序'), appid: 'WX123' }])).toBeNull()
    })

    it('菜单 URL 超过 1024 字节时拒绝', () => {
        const longUrl = `https://example.com/${'a'.repeat(1024)}`
        expect(readWechatMenuButtons([{ ...miniButton('小程序'), url: longUrl }])).toBeNull()
        expect(readWechatMenuButtons([{ id: 'id-view', name: '官网', type: 'view', url: longUrl }])).toBeNull()
    })

    it('动作字段缺失时按类型分别拒绝', () => {
        expect(readWechatMenuButtons([{ id: 'id-1', name: '图片', type: 'media_id' }])).toBeNull()
        expect(readWechatMenuButtons([{ id: 'id-2', name: '图文', type: 'article_id' }])).toBeNull()
        expect(readWechatMenuButtons([{ id: 'id-3', name: '网页', type: 'view' }])).toBeNull()
        expect(
            readWechatMenuButtons([
                { id: 'id-4', name: '小程序', type: 'miniprogram', appid: 'wx1', pagepath: 'pages/index' },
            ]),
        ).toBeNull()
        expect(
            readWechatMenuButtons([
                { id: 'id-5', name: '小程序', type: 'miniprogram', appid: 'wx1', url: 'https://example.com' },
            ]),
        ).toBeNull()
    })

    it('小程序兜底网页只放行 http/https', () => {
        expect(
            readWechatMenuButtons([
                { ...miniButton('小程序'), url: 'javascript:alert(1)' },
            ]),
        ).toBeNull()
    })

    it('多余字段被裁掉，只保留结构化字段', () => {
        const buttons = readWechatMenuButtons([
            {
                id: 'id-1',
                name: '图片',
                type: 'media_id',
                mediaId: 'M',
                url: 'https://x',
                articleId: 'A',
                subButton: undefined,
                extra: 1,
            },
        ])
        expect(buttons?.[0]).toEqual({ id: 'id-1', name: '图片', type: 'media_id', mediaId: 'M' })
    })

    it('二级名称上限更宽松：60 字节约 20 个汉字', () => {
        // 15 个汉字 = 45 字节，未超限
        const ok = {
            id: 'id-group-3',
            name: '更多',
            subButton: [{ id: 'id-child', name: '一二三四五六七八九十一二三四五', type: 'media_id', mediaId: 'M' }],
        }
        expect(readWechatMenuButtons([ok])).not.toBeNull()
        // 21 个汉字 = 63 字节，超过 60 字节上限
        const tooLong = {
            id: 'id-group-4',
            name: '更多',
            subButton: [
                {
                    id: 'id-child',
                    name: '一二三四五六七八九十一二三四五六七八九十一',
                    type: 'media_id',
                    mediaId: 'M',
                },
            ],
        }
        expect(readWechatMenuButtons([tooLong])).toBeNull()
    })

    it('接受四种合法内容并只保留本类型字段', () => {
        const buttons = readWechatMenuButtons([
            {
                id: 'id-image',
                name: '图片',
                type: 'media_id',
                mediaId: 'media1',
                content: { kind: 'image', materialId: 'm1', mediaId: 'media1', url: 'https://x', materialName: '图' },
            },
            {
                id: 'id-news',
                name: '图文',
                type: 'article_id',
                articleId: 'article1',
                content: {
                    kind: 'news',
                    issueId: 'i1',
                    articleId: 'article1',
                    title: '图文标题',
                    articleCount: 3,
                    extra: 1,
                },
            },
            {
                id: 'id-group',
                name: '更多',
                subButton: [
                    {
                        id: 'id-view-link',
                        name: '官网',
                        type: 'view',
                        url: 'https://example.com',
                        content: { kind: 'link', linkUrl: 'https://example.com' },
                    },
                    {
                        ...miniButton('小程序'),
                        content: {
                            kind: 'miniprogram',
                            appid: 'wx123',
                            pagepath: 'pages/index/index',
                            miniUrl: 'https://example.com',
                        },
                    },
                ],
            },
        ])
        expect(buttons).not.toBeNull()
        expect(buttons?.[0]?.content).toEqual({
            kind: 'image',
            materialId: 'm1',
            mediaId: 'media1',
            url: 'https://x',
            materialName: '图',
        })
        expect(buttons?.[1]?.content).toEqual({
            kind: 'news',
            issueId: 'i1',
            articleId: 'article1',
            title: '图文标题',
            articleCount: 3,
        })
        expect(buttons?.[2]?.subButton?.[0]?.content).toEqual({ kind: 'link', linkUrl: 'https://example.com' })
        expect(buttons?.[2]?.subButton?.[1]?.content).toEqual({
            kind: 'miniprogram',
            appid: 'wx123',
            pagepath: 'pages/index/index',
            miniUrl: 'https://example.com',
        })
    })

    it('内容与动作类型不匹配时整棵菜单被拒绝', () => {
        expect(
            readWechatMenuButtons([
                {
                    id: 'id-1',
                    name: '图文',
                    type: 'media_id',
                    mediaId: 'M',
                    content: { kind: 'news', issueId: 'i', articleId: 'A', title: '标题' },
                },
            ]),
        ).toBeNull()
        expect(
            readWechatMenuButtons([
                {
                    id: 'id-2',
                    name: '文本',
                    type: 'media_id',
                    mediaId: 'M',
                    content: { kind: 'text', text: '你好' },
                },
            ]),
        ).toBeNull()
    })

    it('内容下发字段与按钮字段不一致时拒绝', () => {
        expect(
            readWechatMenuButtons([
                {
                    id: 'id-1',
                    name: '图片',
                    type: 'media_id',
                    mediaId: 'M1',
                    content: { kind: 'image', materialId: 'm', mediaId: 'M2', url: 'https://x' },
                },
            ]),
        ).toBeNull()
        expect(
            readWechatMenuButtons([
                {
                    id: 'id-2',
                    name: '官网',
                    type: 'view',
                    url: 'https://example.com',
                    content: { kind: 'link', linkUrl: 'https://other.com' },
                },
            ]),
        ).toBeNull()
    })

    it('内容必填字段缺失或类型未知时整棵菜单被拒绝', () => {
        const withContent = (content: Record<string, unknown>): unknown[] => [
            { id: 'id-1', name: '菜单', type: 'media_id', mediaId: 'M', content },
        ]
        expect(readWechatMenuButtons(withContent({ kind: 'image', materialId: 'm' }))).toBeNull()
        expect(readWechatMenuButtons(withContent({ kind: 'news', issueId: 'i' }))).toBeNull()
        expect(readWechatMenuButtons(withContent({ kind: 'video', url: 'https://x' }))).toBeNull()
    })

    it('view 菜单保留合法的 link 内容并拒绝危险协议', () => {
        const links = readWechatMenuButtons([
            {
                id: 'id-view-link',
                name: '官网',
                type: 'view',
                url: 'https://example.com',
                content: { kind: 'link', linkUrl: 'https://example.com' },
            },
        ])
        expect(links?.[0]?.content).toEqual({ kind: 'link', linkUrl: 'https://example.com' })
        expect(
            readWechatMenuButtons([
                {
                    id: 'id-view-bad',
                    name: '危险链接',
                    type: 'view',
                    url: 'javascript:alert(1)',
                    content: { kind: 'link', linkUrl: 'javascript:alert(1)' },
                },
            ]),
        ).toBeNull()
    })

    it('id 原样保留，缺失或空白 id 直接拒绝', () => {
        const buttons = readWechatMenuButtons([{ id: ' menu-1 ', name: '菜单', type: 'media_id', mediaId: 'M' }])
        expect(buttons?.[0]?.id).toBe('menu-1')
        expect(readWechatMenuButtons([{ id: '   ', name: '菜单', type: 'media_id', mediaId: 'M' }])).toBeNull()
        expect(readWechatMenuButtons([{ name: '菜单', type: 'media_id', mediaId: 'M' }])).toBeNull()
    })

    it('目录与子菜单的 id 同样保留', () => {
        const buttons = readWechatMenuButtons([
            {
                id: 'group-1',
                name: '目录',
                subButton: [{ id: 'child-1', name: '子菜单', type: 'media_id', mediaId: 'M' }],
            },
        ])
        expect(buttons?.[0]?.id).toBe('group-1')
        expect(buttons?.[0]?.subButton?.[0]?.id).toBe('child-1')
    })

    it('二级菜单的内容同样参与校验', () => {
        const group = {
            id: 'id-group-5',
            name: '更多',
            subButton: [
                {
                    id: 'id-child-2',
                    name: '图片',
                    type: 'media_id',
                    mediaId: 'M',
                    content: { kind: 'image', materialId: 'm', mediaId: 'M', url: 'https://x' },
                },
            ],
        }
        expect(readWechatMenuButtons([group])).not.toBeNull()
        const broken = {
            id: 'id-group-6',
            name: '更多',
            subButton: [
                {
                    id: 'id-child-3',
                    name: '图片',
                    type: 'media_id',
                    mediaId: 'M',
                    content: { kind: 'image', materialId: 'm', mediaId: 'M', url: '' },
                },
            ],
        }
        expect(readWechatMenuButtons([broken])).toBeNull()
    })
})
