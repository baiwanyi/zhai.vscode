/**
 * 分批渲染上限：列表按固定步长逐步展开，避免一次性挂载全部条目。
 * 复用约定：调用方只给总数与步长，切片由调用方完成；resetKey 变化时原地回到首批，
 * 在渲染期对齐而不在 effect 里写 state（多一轮渲染代价更大）。
 * 关键约束：上限只增不减，收窄范围靠 resetKey 触发；
 * step 变化不重置已展开数量，避免运行中调整步长把用户已经看过的内容收回去。
 */
import { useCallback, useState } from 'react'

export interface RenderLimitState {
    /** 当前渲染上限 */
    limit: number
    hasMore: boolean
    /** 尚未渲染的条数 */
    remaining: number
    loadMore: () => void
}

export function useRenderLimit(total: number, step: number, resetKey = ''): RenderLimitState {
    const [paging, setPaging] = useState({ resetKey, limit: step })
    // 渲染期直接取首批：resetKey 变化即视为新一轮，避免用 effect 同步一次 state
    const limit = paging.resetKey === resetKey ? paging.limit : step

    const loadMore = useCallback((): void => {
        setPaging({ resetKey, limit: limit + step })
    }, [limit, resetKey, step])

    const remaining = Math.max(total - limit, 0)

    return { limit, hasMore: remaining > 0, remaining, loadMore }
}
