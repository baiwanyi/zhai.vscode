/**
 * 媒体页多选状态：选中集合与产生它的筛选签名绑定，另附全选判断。
 * 复用约定：只持有集合与基于「当前可见图片」的派生值，媒体数据与删除动作由页面注入；
 * 选中以媒体 id 为键——路径可能因文件移动而变化，id 是稳定标识。
 * 关键约束：签名与当前筛选不一致即派生出空集，不必在每处筛选回调里手动清空——
 * 改回「回调里逐个清空」会让「已选 N 张」与实际可见图片对不上，这是本 hook 最易回退的一点；
 * 全选只覆盖已渲染的图片，未加载的图不在视野里，不该被批量操作带走。
 */
import { useState } from 'react'
import type { MediaItem } from '@shared/types/media'

/** 空选中集合：换筛选后的派生值与清空操作复用同一对象，避免每次渲染新建 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

/** 选中集合与产生它的筛选签名：签名变化后旧勾选自然失效 */
interface SelectionSnapshot {
    signature: string
    ids: ReadonlySet<string>
}

interface UseMediaSelectionParams {
    /** 当前已渲染的图片：全选只覆盖这一批 */
    visibleItems: ReadonlyArray<MediaItem>
    /** 当前筛选签名：与选中集合绑定，换筛选即视为空 */
    filterSignature: string
}

interface UseMediaSelectionResult {
    isSelecting: boolean
    /** 当前生效的选中集合：签名与筛选不一致时为空集 */
    selectedIds: ReadonlySet<string>
    isAllVisibleSelected: boolean
    /** 进入或退出多选：两个方向都清空已选，避免下次进入时残留上次的勾选 */
    toggleSelecting: () => void
    /** 退出多选并清空：批量删除成功后收尾用 */
    exitSelecting: () => void
    toggleImage: (image: MediaItem) => void
    selectAll: () => void
}

export function useImageSelection({
    visibleItems,
    filterSignature,
}: UseMediaSelectionParams): UseMediaSelectionResult {
    const [selection, setSelection] = useState<SelectionSnapshot>({ signature: '', ids: EMPTY_SELECTION })
    /** 多选模式：点击卡片切换选中，不打开详情 */
    const [isSelecting, setIsSelecting] = useState(false)

    const selectedIds = selection.signature === filterSignature ? selection.ids : EMPTY_SELECTION
    const isAllVisibleSelected = visibleItems.length > 0 && selectedIds.size === visibleItems.length

    /** 写入选中集合时一并记下当前筛选签名，供上面的派生判断使用 */
    const updateSelection = (next: ReadonlySet<string>): void => {
        setSelection({ signature: filterSignature, ids: next })
    }

    const toggleSelecting = (): void => {
        setIsSelecting((current) => !current)
        updateSelection(EMPTY_SELECTION)
    }

    const exitSelecting = (): void => {
        setIsSelecting(false)
        updateSelection(EMPTY_SELECTION)
    }

    const toggleImage = (image: MediaItem): void => {
        const next = new Set(selectedIds)
        if (next.has(image.id)) {
            next.delete(image.id)
        } else {
            next.add(image.id)
        }
        updateSelection(next)
    }

    const selectAll = (): void => {
        updateSelection(isAllVisibleSelected ? EMPTY_SELECTION : new Set(visibleItems.map((image) => image.id)))
    }

    return { isSelecting, selectedIds, isAllVisibleSelected, toggleSelecting, exitSelecting, toggleImage, selectAll }
}
