/**
 * 提取范围选择：把模式、章节范围、卷筛选与勾选状态收成一个 Hook，并负责把选择换算成写入目标。
 * 复用约定：章节选项、卷选项、章序夹取与区间展开都来自 ../utils，模式枚举与选项表来自 ../constants，
 * 写入目标与大纲条目取自 ../types；组件只承担渲染与弹层开合，提交口径统一由 resolveTarget 给出。
 * 关键约束：章序是「卷顺序 + 卷内数组顺序」摊平的 1 基全局序号，派生时不得重排；
 * 章节增删后可能残留越界勾选，摘要、禁用判断与提交一律走 validSelectedOrders；
 * 「全选」只并入当前筛选下的章，便于按卷逐次累加。
 */
import { useMemo, useState } from 'react'
import type { ExtractScope } from '../../constants'
import type { OutlineExtractTarget, OutlineTreeEntry } from '../../types'
import type { ExtractChapterOption } from '../../utils'
import { isExtractScope } from '../../constants'
import { clampChapterOrder, createChapterOptions, createOrderRange, createVolumeOptions } from '../../utils'

export interface ExtractSelection {
    scope: ExtractScope
    rangeStart: string
    rangeEnd: string
    volumeFilter: string
    /** 全书章数，供摘要与输入框上限使用 */
    totalCount: number
    chapterOptions: readonly ExtractChapterOption[]
    volumeOptions: readonly { value: string; label: string }[]
    visibleOptions: readonly ExtractChapterOption[]
    validSelectedOrders: readonly number[]
    summaryText: string
    isSubmitDisabled: boolean
    changeScope: (value: string) => void
    changeRangeStart: (value: string) => void
    changeRangeEnd: (value: string) => void
    changeVolumeFilter: (value: string) => void
    toggleChapter: (order: number) => void
    selectAllVisible: () => void
    clearSelection: () => void
    /** 写入目标：全篇整树覆盖，或去重排序后的 1 基全局章序 */
    resolveTarget: () => OutlineExtractTarget
}

export function useExtractSelection(entries: readonly OutlineTreeEntry[], isExtracting: boolean): ExtractSelection {
    const [scope, setScope] = useState<ExtractScope>('all')
    const [rangeStart, setRangeStart] = useState('1')
    /** 结束章留空表示到全书末章：初值不写死章数，否则挂载后才生成大纲时会停在旧值 */
    const [rangeEnd, setRangeEnd] = useState('')
    /** 勾选的全局章序：用序号而非章节 id，宿主侧按同一口径对齐素材草案 */
    const [selectedOrders, setSelectedOrders] = useState<number[]>([])
    /** 指定章节列表的卷筛选：'all' 为全部卷，否则为卷 id */
    const [volumeFilter, setVolumeFilter] = useState('all')

    const totalCount = entries.length
    const chapterOptions = useMemo(() => createChapterOptions(entries), [entries])
    const volumeOptions = useMemo(() => createVolumeOptions(entries), [entries])
    const visibleOptions = useMemo(
        () =>
            volumeFilter === 'all'
                ? chapterOptions
                : chapterOptions.filter((option) => option.volumeId === volumeFilter),
        [chapterOptions, volumeFilter],
    )

    /** 有效勾选：章节增删后可能残留越界序号，摘要、禁用判断与提交统一按它计算，不留给人手清理 */
    const validSelectedOrders = useMemo(
        () => selectedOrders.filter((order) => order <= totalCount),
        [selectedOrders, totalCount],
    )

    const startOrder = clampChapterOrder(rangeStart, 1, totalCount)
    const endOrder = clampChapterOrder(rangeEnd, Math.max(totalCount, 1), totalCount)

    /** 勾选切换：方向由 previous 现算，不依赖渲染期快照，连点两次也能正确回到原状态 */
    const toggleChapter = (order: number): void => {
        setSelectedOrders((previous) =>
            previous.includes(order) ? previous.filter((item) => item !== order) : [...previous, order],
        )
    }

    /** 全选：只并入当前筛选下可见的章，配合卷筛选可逐卷累加 */
    const selectAllVisible = (): void => {
        setSelectedOrders((previous) =>
            [...new Set([...previous, ...visibleOptions.map((option) => option.order)])].sort(
                (left, right) => left - right,
            ),
        )
    }

    const changeScope = (value: string): void => {
        if (isExtractScope(value)) {
            setScope(value)
        }
    }

    const resolveTarget = (): OutlineExtractTarget => {
        if (scope === 'all') {
            return { mode: 'all' }
        }
        if (scope === 'range') {
            return { mode: 'orders', orders: createOrderRange(startOrder, endOrder) }
        }
        return { mode: 'orders', orders: [...validSelectedOrders].sort((left, right) => left - right) }
    }

    const isSubmitDisabled =
        isExtracting || totalCount === 0 || (scope === 'chapters' && validSelectedOrders.length === 0)

    /** 头部摘要：各模式的统计收敛到同一行，避免每块内容各带一行说明 */
    const scopeSummary = volumeFilter === 'all' ? '' : ` · 当前卷 ${String(visibleOptions.length)} 章`
    const summaryText =
        scope === 'chapters'
            ? `已选 ${String(validSelectedOrders.length)} / ${String(totalCount)} 章${scopeSummary}`
            : `全书共 ${String(totalCount)} 章`

    return {
        scope,
        rangeStart,
        rangeEnd,
        volumeFilter,
        totalCount,
        chapterOptions,
        volumeOptions,
        visibleOptions,
        validSelectedOrders,
        summaryText,
        isSubmitDisabled,
        changeScope,
        changeRangeStart: setRangeStart,
        changeRangeEnd: setRangeEnd,
        changeVolumeFilter: setVolumeFilter,
        toggleChapter,
        selectAllVisible,
        clearSelection: () => setSelectedOrders([]),
        resolveTarget,
    }
}
