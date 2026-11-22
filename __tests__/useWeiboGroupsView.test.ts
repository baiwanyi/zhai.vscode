// @vitest-environment jsdom
/**
 * useWeiboGroupsView 用例：分组结果到视图三项的折算与引用稳定性。
 * 复用约定：renderHook + 直接构造控制器 state，不涉及 request（本 Hook 纯衍生、无副作用）。
 * 关键约束：分组未到货时三项统一回落空数组与 null；同一份 groups 下重渲染不换引用。
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WeiboGroupsResult } from '@shared/types/weibo'
import type { WeiboGroupsController } from '@webview/weibo/hooks/useWeiboGroups'
import { useWeiboGroupsView } from '@webview/weibo/hooks/useWeiboGroupsView'

/** 构造控制器状态：本 Hook 只读 groups，其余字段给未加载态 */
function createState(groups: WeiboGroupsResult | null): WeiboGroupsController['state'] {
    return { groups, isLoading: false, errorMessage: null }
}

const GROUPS: WeiboGroupsResult = {
    defaultGroups: [{ gid: '1900', title: '最新微博', uid: '3793264344', isCustom: false }],
    myGroups: [{ gid: '1001', title: '技术', uid: '3793264344', isCustom: true }],
    hotChannels: [{ gid: '2001', title: '颜值', containerId: '102803_ctg1_2001_-_ctg1_2001' }],
    timelineListId: '1900',
    uid: '3793264344',
}

describe('useWeiboGroupsView', () => {
    it('分组未到货时三项回落空数组与 null', () => {
        const { result } = renderHook(() => useWeiboGroupsView(createState(null)))
        expect(result.current.myGroups).toEqual([])
        expect(result.current.hotChannelPool).toEqual([])
        expect(result.current.timelineListId).toBeNull()
    })

    it('分组到货后透传我的分组、频道池与 list_id', () => {
        const { result } = renderHook(() => useWeiboGroupsView(createState(GROUPS)))
        expect(result.current.myGroups).toEqual(GROUPS.myGroups)
        expect(result.current.hotChannelPool).toEqual(GROUPS.hotChannels)
        expect(result.current.timelineListId).toBe('1900')
    })

    it('同一份 groups 重渲染时三项引用不变', () => {
        const state = createState(GROUPS)
        const { result, rerender } = renderHook(() => useWeiboGroupsView(state))
        const first = result.current
        rerender()
        expect(result.current.myGroups).toBe(first.myGroups)
        expect(result.current.hotChannelPool).toBe(first.hotChannelPool)
    })
})
