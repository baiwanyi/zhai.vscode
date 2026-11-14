/**
 * 段末批注弹层：承接段末图标的点击委托、坐标测量、该块批注筛选与滚动收起。
 * 复用约定：标注数据由 useAnnotations 提供，本 hook 只维护「打开哪一块、列哪些条」的视图状态；
 * 图标是 ProseMirror 插入的原生 widget，只能靠容器事件委托拿到点击，读写契约见 domContracts。
 * 关键约束：弹层坐标是打开瞬间的视口值，正文一滚就与图标脱节，滚动即收起；
 * 新增批注成功后必须 close()，否则同块后续再有批注时弹层会自动弹出。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnnotationRecord } from '@shared/types/editor'
import type { MouseEvent, RefObject } from 'react'
import { selectBlockAnnotations } from '../annotations/selectors'
import { EDITOR_SCROLL_CLASS, readAnnotationMarker } from '../core/domContracts'

/** 段末图标与气泡之间的间距 */
const POPOVER_OFFSET = 4

/** 弹层的打开目标：坐标与所属块号一起冻结，避免筛选时二次读取 DOM */
interface OpenTarget {
    left: number
    top: number
    blockIndex: number
}

export interface UseAnnotationPopoverResult {
    isOpen: boolean
    left: number
    top: number
    /** 该块下的批注（已排除 orphaned），弹层只渲染这份列表 */
    items: readonly AnnotationRecord[]
    handleContentClick: (event: MouseEvent<HTMLDivElement>) => void
    close: () => void
}

export function useAnnotationPopover(
    items: readonly AnnotationRecord[],
    containerRef: RefObject<HTMLDivElement | null>,
): UseAnnotationPopoverResult {
    const [target, setTarget] = useState<OpenTarget | null>(null)
    const blockIndex = target?.blockIndex ?? null
    const blockItems = useMemo(
        () => (blockIndex === null ? [] : selectBlockAnnotations(items, blockIndex, 'note')),
        [blockIndex, items],
    )

    const handleContentClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
        const marker = readAnnotationMarker(event.target)
        if (marker === null) {
            return
        }
        setTarget({
            left: marker.rect.left,
            top: marker.rect.bottom + POPOVER_OFFSET,
            blockIndex: marker.blockIndex,
        })
    }, [])

    const close = useCallback((): void => {
        setTarget(null)
    }, [])

    // 该块最后一条批注被删掉后弹层自身已无可渲染内容（内部返回 null），target 必须一并清掉；
    // 否则同块之后再新增批注时 target 仍指向该块，弹层会在没点图标的情况下自动弹出
    useEffect(() => {
        if (target !== null && blockItems.length === 0) {
            setTarget(null)
        }
    }, [blockItems.length, target])

    // 弹层坐标是打开瞬间的视口值：正文一滚就与段末图标脱节，滚动即收起
    useEffect(() => {
        if (target === null) {
            return
        }
        const handleScroll = (): void => {
            setTarget(null)
        }
        const scroller = containerRef.current?.closest(`.${EDITOR_SCROLL_CLASS}`)
        // 找不到滚动容器时退化到 window：scroll 不冒泡但捕获阶段能收到，
        // 避免类名或层级变动后监听静默失效、弹层永不收起
        const scrollTarget: EventTarget = scroller instanceof HTMLElement ? scroller : window
        scrollTarget.addEventListener('scroll', handleScroll, { passive: true, capture: true })
        return (): void => {
            scrollTarget.removeEventListener('scroll', handleScroll, { capture: true })
        }
    }, [containerRef, target])

    return {
        isOpen: target !== null,
        left: target?.left ?? 0,
        top: target?.top ?? 0,
        items: blockItems,
        handleContentClick,
        close,
    }
}
