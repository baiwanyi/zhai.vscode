/**
 * 菜单结构校验的单元测试：覆盖数量上限、名称字节上限、三种动作的必填字段与目录节点。
 * 纯函数测试：校验规则是「保存到平台前唯一的口径」，界面与宿主都依赖它，必须逐条锁住。
 * 关注点是「什么会被拒绝」，而不是只验证合法输入能通过。
 */
import { describe, expect, it } from 'vitest'
import { readWechatMenuButtons, WECHAT_MENU_SUB_LIMIT, WECHAT_MENU_TOP_LIMIT } from '../../src/shared/types/wechat'

/** 构造一个合法的发送消息按钮 */
function clickButton(name: string): Record<string, unknown> {
    return { name, type: 'click', key: `KEY_${name}` }
}

describe('readWechatMenuButtons', () => {
    it('接受三种动作的合法一级菜单', () => {
        const buttons = readWechatMenuButtons([
            clickButton('关于'),
            { name: '官网', type: 'view', url: 'https://example.com' },
            { name: '小程序', type: 'miniprogram', appid: 'wx123', pagepath: 'pages/index/index' },
        ])
        expect(buttons).toHaveLength(3)
        expect(buttons?.[1]).toEqual({ name: '官网', type: 'view', url: 'https://example.com' })
    })

    it('一级超过 3 个直接拒绝', () => {
        const four = Array.from({ length: WECHAT_MENU_TOP_LIMIT + 1 }, (_, index) =>
            clickButton(`菜单${String(index)}`),
        )
        expect(readWechatMenuButtons(four)).toBeNull()
    })

    it('空数组与空名称拒绝', () => {
        expect(readWechatMenuButtons([])).toBeNull()
        expect(readWechatMenuButtons([{ name: '   ', type: 'click', key: 'A' }])).toBeNull()
    })

    it('一级名称按 UTF-8 字节计：6 个汉字（18 字节）超限', () => {
        expect(readWechatMenuButtons([clickButton('一二三四五')])).not.toBeNull()
        expect(readWechatMenuButtons([clickButton('一二三四五六')])).toBeNull()
    })

    it('目录节点不需要动作字段，二级超过 5 个拒绝', () => {
        const group = { name: '更多', subButton: [clickButton('子一'), clickButton('子二')] }
        expect(readWechatMenuButtons([group])).not.toBeNull()

        const tooMany = {
            name: '更多',
            subButton: Array.from({ length: WECHAT_MENU_SUB_LIMIT + 1 }, (_, index) =>
                clickButton(`子${String(index)}`),
            ),
        }
        expect(readWechatMenuButtons([tooMany])).toBeNull()
    })

    it('空目录（subButton 为空数组）拒绝', () => {
        expect(readWechatMenuButtons([{ name: '更多', subButton: [] }])).toBeNull()
    })

    it('动作字段缺失时按类型分别拒绝', () => {
        expect(readWechatMenuButtons([{ name: '消息', type: 'click' }])).toBeNull()
        expect(readWechatMenuButtons([{ name: '网页', type: 'view' }])).toBeNull()
        expect(readWechatMenuButtons([{ name: '小程序', type: 'miniprogram', appid: 'wx1' }])).toBeNull()
        expect(readWechatMenuButtons([{ name: '未知', type: 'scancode_push', key: 'A' }])).toBeNull()
    })

    it('多余字段被裁掉，只保留结构化字段', () => {
        const buttons = readWechatMenuButtons([
            { name: '关于', type: 'click', key: 'K', url: 'https://x', subButton: undefined, extra: 1 },
        ])
        expect(buttons?.[0]).toEqual({ name: '关于', type: 'click', key: 'K' })
    })

    it('二级名称上限更宽松：60 字节约 20 个汉字', () => {
        // 15 个汉字 = 45 字节，未超限
        const ok = { name: '更多', subButton: [{ name: '一二三四五六七八九十一二三四五', type: 'click', key: 'K' }] }
        expect(readWechatMenuButtons([ok])).not.toBeNull()
        // 21 个汉字 = 63 字节，超过 60 字节上限
        const tooLong = {
            name: '更多',
            subButton: [{ name: '一二三四五六七八九十一二三四五六七八九十一', type: 'click', key: 'K' }],
        }
        expect(readWechatMenuButtons([tooLong])).toBeNull()
    })
})
