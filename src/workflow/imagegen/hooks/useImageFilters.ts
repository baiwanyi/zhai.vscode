/**
 * 生图页筛选与分批：把「图片类别 + 角色」两个筛选维度、分项计数与分批上限收在一处。
 * 复用约定：图片类型取 @shared/types/imagegen，全部派生都在内存中完成，不发起请求；
 * 计数里「全部」取传入列表长度，「作品封面」按 coverSelectedId 是否指向得出（0 或 1），其余取宿主分项数。
 * 关键约束：「作品封面」是「当前封面指针」这一维度而非图片类别；分批上限与筛选签名绑定，
 * 筛选一变即自然回到首批，切回同一筛选时保留上次的累计上限；调用方的选中集合判断也要复用该签名。
 */
import { useMemo, useState } from 'react'
import type { PressImageItem, PressImageKind } from '@shared/types/imagegen'

/** 类型筛选：封面是「当前选中」维度，与图片自身的类别并列展示 */
export type KindFilter = 'all' | 'cover' | PressImageKind

/** 网格分批挂载的步长：一次只进一屏出头的卡片，避免上百张图同时进 DOM */
const GRID_PAGE_SIZE = 60

interface UseImageFiltersParams {
    /** 全部图片：筛选与「全部」计数的唯一数据源 */
    images: PressImageItem[]
    /** 宿主分项数：类别计数直接取用，前端不重复分类 */
    counts: Record<PressImageKind, number>
    /** 作品封面当前指向的图片 id：「作品封面」维度据此命中 */
    coverSelectedId: string | null
}

interface UseImageFiltersResult {
    kind: KindFilter
    setKind: (kind: KindFilter) => void
    /** 角色筛选值：'all' 表示不限 */
    characterId: string
    setCharacterId: (characterId: string) => void
    /** 顶栏选中的角色：'all' 折算为 null，供出图认领与 composer 使用 */
    activeCharacterId: string | null
    /** 当前筛选结果：批量删除按它取交集，不受分批上限影响 */
    filtered: PressImageItem[]
    kindCounts: Readonly<Record<KindFilter, number>>
    /** 是否存在生效中的筛选：决定是否显示「清空筛选」 */
    hasActiveFilter: boolean
    clearFilters: () => void
    /** 当前筛选签名：选中集合与分批上限都以它为界 */
    filterSignature: string
    /** 已渲染的一批图片：全选与网格只覆盖这一批 */
    visibleImages: PressImageItem[]
    /** 追加下一批 */
    loadMore: () => void
}

export function useImageFilters({ images, counts, coverSelectedId }: UseImageFiltersParams): UseImageFiltersResult {
    const [kind, setKind] = useState<KindFilter>('all')
    const [characterId, setCharacterId] = useState('all')

    /** 顶栏选中的角色：'all' 是筛选占位值，对下游一律折算为 null，避免各处重复判断 */
    const activeCharacterId = characterId === 'all' ? null : characterId

    /** 筛选只看角色与图片类别：「作品封面」是维度而非类别，命中当前封面指针即通过 */
    const filtered = useMemo(
        () =>
            images.filter((image) => {
                if (activeCharacterId !== null && image.characterId !== activeCharacterId) {
                    return false
                }
                if (kind === 'cover') {
                    return image.id === coverSelectedId
                }
                return kind === 'all' || image.kind === kind
            }),
        [images, kind, activeCharacterId, coverSelectedId],
    )

    /** 筛选计数：全部与作品封面由列表推导，其余取宿主分项数，算好后交给筛选组件呈现 */
    const kindCounts = useMemo<Record<KindFilter, number>>(
        () => ({
            all: images.length,
            cover: coverSelectedId === null ? 0 : 1,
            portrait: counts.portrait,
            lore: counts.lore,
            photo: counts.photo,
            orphan: counts.orphan,
        }),
        [images.length, coverSelectedId, counts],
    )

    /**
     * 分批：用筛选签名比对而不是在每处 onChange 里重置，筛选一变即自然回到首批。
     * 已显示数量随签名保存，切回同一筛选时不必重新点「加载更多」。
     */
    const [paging, setPaging] = useState({ signature: '', count: GRID_PAGE_SIZE })
    const filterSignature = `${kind}|${characterId}`
    /** 本批渲染上限：签名与当前筛选不符即回到首批 */
    const renderLimit = paging.signature === filterSignature ? paging.count : GRID_PAGE_SIZE
    const visibleImages = useMemo(() => filtered.slice(0, renderLimit), [filtered, renderLimit])

    const hasActiveFilter = kind !== 'all' || characterId !== 'all'

    /** 一键回到全部结果：两个筛选维度一起复位，避免逐个点回 */
    const clearFilters = (): void => {
        setKind('all')
        setCharacterId('all')
    }

    /** 追加一批：记下当前筛选签名，筛选未变时在累计上限上继续加 */
    const loadMore = (): void => {
        setPaging({ signature: filterSignature, count: renderLimit + GRID_PAGE_SIZE })
    }

    return {
        kind,
        setKind,
        characterId,
        setCharacterId,
        activeCharacterId,
        filtered,
        kindCounts,
        hasActiveFilter,
        clearFilters,
        filterSignature,
        visibleImages,
        loadMore,
    }
}
