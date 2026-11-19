/**
 * 提取范围选择：把模式、章节范围、卷筛选与勾选状态收成一个 Hook，并负责把选择换算成写入目标。
 * 复用约定：章节选项由调用方按仪表盘的作品列表构建（utils.createProjectChapterOptions），
 * 章序夹取与区间展开取 ../utils，模式枚举与选项表取 ../constants，目标类型取 ../types。
 * 关键约束：选项只来自作品列表，素材草案由章节清单产出，按大纲章选择会与素材错位；
 * 全局序只服务列表展示与区间输入，写入目标一律换算成「卷序 + 卷内位置」的定位键；
 * 章节增删后可能残留越界勾选，摘要、禁用判断与提交一律走 validSelectedOrders；
 * 「全选」只并入当前筛选下的章，便于按卷逐次累加。
 */
import { useMemo, useState } from 'react'
import type { ExtractScope } from '../../constants'
import type { OutlineExtractKey, OutlineExtractTarget } from '../../types'
import type { ProjectChapterOption } from '../../utils'
import { isExtractScope } from '../../constants'
import { clampChapterOrder, createOrderRange } from '../../utils'

export interface ExtractSelection {
    scope: ExtractScope
    rangeStart: string
    rangeEnd: string
    volumeFilter: string
    /** 作品章节总数，供摘要与输入框上限使用 */
    totalCount: number
    chapterOptions: readonly ProjectChapterOption[]
    volumeOptions: readonly { value: string; label: string }[]
    visibleOptions: readonly ProjectChapterOption[]
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
    /** 写入目标：全篇整树覆盖，或按「卷序 + 卷内位置」定位的一组章 */
    resolveTarget: () => OutlineExtractTarget
}

/** 由全局序换算定位键：区间与勾选都先归一成全局序，再按选项表映射 */
function toExtractKeys(options: readonly ProjectChapterOption[], orders: ReadonlySet<number>): OutlineExtractKey[] {
    return options
        .filter((option) => orders.has(option.order))
        .map((option) => ({ volumeOrder: option.volumeOrder, chapterIndex: option.chapterIndex }))
}

export function useExtractSelection(options: readonly ProjectChapterOption[], isExtracting: boolean): ExtractSelection {
    const [scope, setScope] = useState<ExtractScope>('all')
    const [rangeStart, setRangeStart] = useState('1')
    /** 结束章留空表示到末章：初值不写死章数，作品章节变化后默认值不会过期 */
    const [rangeEnd, setRangeEnd] = useState('')
    /** 勾选的全局章序：只作列表内标识，提交时换算成卷序 + 卷内位置 */
    const [selectedOrders, setSelectedOrders] = useState<number[]>([])
    /** 指定章节列表的卷筛选：'all' 为全部卷，否则为卷目录名 */
    const [volumeFilter, setVolumeFilter] = useState('all')

    const totalCount = options.length
    const volumeOptions = useMemo(() => {
        const seen = new Map<string, string>()
        for (const option of options) {
            if (!seen.has(option.volumeId)) {
                seen.set(option.volumeId, option.volumeLabel)
            }
        }
        return [...seen].map(([value, label]) => ({ value, label }))
    }, [options])
    const visibleOptions = useMemo(
        () => (volumeFilter === 'all' ? options : options.filter((option) => option.volumeId === volumeFilter)),
        [options, volumeFilter],
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
        const orders = new Set(scope === 'range' ? createOrderRange(startOrder, endOrder) : [...validSelectedOrders])
        return { mode: 'chapters', keys: toExtractKeys(options, orders) }
    }

    const isSubmitDisabled =
        isExtracting || totalCount === 0 || (scope === 'chapters' && validSelectedOrders.length === 0)

    /** 头部摘要：各模式的统计收敛到同一行，避免每块内容各带一行说明 */
    const scopeSummary = volumeFilter === 'all' ? '' : ` · 当前卷 ${String(visibleOptions.length)} 章`
    const summaryText =
        scope === 'chapters'
            ? `已选 ${String(validSelectedOrders.length)} / ${String(totalCount)} 章${scopeSummary}`
            : `作品共 ${String(totalCount)} 章`

    return {
        scope,
        rangeStart,
        rangeEnd,
        volumeFilter,
        totalCount,
        chapterOptions: options,
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
