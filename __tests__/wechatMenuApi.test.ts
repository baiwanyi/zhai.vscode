/**
 * 菜单平台接口单元测试：锁定 menu/get 返回体解析路径与错误归一。
 * 复用约定：用 vi.stubGlobal('fetch') 接管网络，直接调用 openapi 的 fetchWechatMenu，不触网；
 * 关键约束：官方返回体顶层是 menu.button，误读顶层 button 会让平台已有菜单永远读成空数组。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWechatMenu } from '../src/modules/wechat/openapi'

/** 构造 JSON 响应：GET 查询类接口统一走 response.json() */
function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

/** 接管 fetch 并固定返回 payload */
function stubFetch(payload: unknown): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonResponse(payload))),
    )
}

describe('fetchWechatMenu', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('从 menu.button 解析平台菜单', async () => {
        stubFetch({
            menu: {
                button: [{ type: 'view', name: '官网', url: 'https://example.com', sub_button: [] }],
            },
        })
        const outcome = await fetchWechatMenu('token')
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) {
            return
        }
        expect(outcome.data).toHaveLength(1)
        expect(outcome.data[0]?.name).toBe('官网')
        expect(outcome.data[0]?.type).toBe('view')
    })

    it('菜单不存在（46003）按空菜单返回', async () => {
        stubFetch({ errcode: 46003, errmsg: 'menu not exist' })
        const outcome = await fetchWechatMenu('token')
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) {
            return
        }
        expect(outcome.data).toEqual([])
    })
})
