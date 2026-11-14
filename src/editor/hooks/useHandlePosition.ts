/**
 * 把手定位的生命周期：常驻跟随光标块、按帧节流、滚动时临时关掉过渡，并在菜单打开期间冻结位置。
 * 复用约定：测量与写入交给 blocks/handlePosition 的 positionHandleAt，本 Hook 只管调度、拖拽锁与清理。
 * 关键约束：菜单打开期间必须同时冻结位置并锁住拖拽（Radix 以把手为锚点，pointerdown 会被原生 dragstart 抢占）；
 * 关闭后先复位再补算，避免补算被自己拦掉；rAF 重试帧不在 frameRef 里，只能靠 disposed 标记叫停；
 * 卸载时还要兜底解锁，否则「菜单开着被移除」（源模式切换）会让拖拽永久锁死。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { RefObject } from 'react'
import { findHandleElement, positionHandleAt } from '../blocks/handlePosition'
import { EDITOR_SCROLL_CLASS } from '../domContracts'

/** drag-handle 扩展的 meta 名：命令不在 editor.commands 类型里，只能按名派发 */
const DRAG_LOCK_META = 'lockDragHandle'

/** 滚动收尾延时：摘掉 data-scrolling、恢复过渡 */
const SCROLL_SETTLE_MS = 120

/** 定位失败后的最大重试帧数：扩展 wrapper 的挂载晚于组件首帧 */
const MAX_POSITION_ATTEMPTS = 9

/** 把手定位对外暴露的状态与操作 */
export interface HandlePositionApi {
    /** 鼠标所在块：由 DragHandle 的 onNodeChange 写，定位时读 */
    blockPosRef: RefObject<number | null>
    /** 最近一次落在块上的位置：鼠标移到把手时扩展给 null，块菜单靠它保住目标 */
    lastBlockPosRef: RefObject<number | null>
    /** 首次定位成功后常驻为 true */
    isVisible: boolean
    /** 触发一次校准（节流到下一帧） */
    schedule: () => void
    /** 立刻点亮把手：鼠标落在块上时用 */
    reveal: () => void
}

/**
 * 锁定 / 解锁把手拖拽：drag-handle 的 React 版扩展通过 registerPlugin 注册，命令不在 editor.commands 类型里，
 * 因此直接派发同名事务 meta；meta 不改文档，不会污染撤销栈。
 */
function setDragLocked(editor: Editor, isLocked: boolean): void {
    if (editor.isDestroyed) {
        return
    }
    editor.view.dispatch(editor.state.tr.setMeta(DRAG_LOCK_META, isLocked))
}

export function useHandlePosition(editor: Editor, isMenuOpen: boolean): HandlePositionApi {
    // 常驻可见：定位成功或鼠标落在块上都会点亮，不只是悬停
    const [isVisible, setIsVisible] = useState(false)
    // 定位按帧节流：键入时每字符都会触发 selectionUpdate，逐次量矩形会抖动
    const frameRef = useRef<number | null>(null)
    // 滚动收尾计时：摘掉 data-scrolling、恢复过渡用
    const scrollTimerRef = useRef<number | null>(null)
    // 定位调度器：悬停回调也要能触发一次校准，故放进 ref 而不是闭包传参
    const scheduleRef = useRef<(() => void) | null>(null)
    // 鼠标所在块：把手跟鼠标走（与扩展一致），没有悬停时退回光标块
    const blockPosRef = useRef<number | null>(null)
    // 最近一次落在块上的位置：鼠标移到把手时扩展给的是 null，块菜单靠它保住目标
    const lastBlockPosRef = useRef<number | null>(null)
    // 有菜单打开时不许重算位置：重算会让 Radix 的锚点跟着把手滑，子菜单来回跳
    const isMenuOpenRef = useRef(false)

    // 常驻定位：光标落到哪个块，把手就沿左侧竖线滑到哪一行
    useEffect(() => {
        if (editor.isDestroyed) {
            return undefined
        }
        // 卸载标记：下面排的 rAF 重试帧不在 frameRef 里，cleanup 取消不到，只能靠它叫停
        let isDisposed = false
        const move = (attempt = 0): void => {
            // 菜单开着时位置必须钉住：块菜单的子菜单以把手为锚点，把手一动手位置就跟着变
            if (isDisposed || isMenuOpenRef.current) {
                return
            }
            let isPositioned = false
            try {
                isPositioned = positionHandleAt(editor, blockPosRef.current)
            } catch {
                // 文档切换、选区越界等瞬时状态下量矩形可能抛错：本轮跳过，等下一次交互校准
            }
            if (isPositioned) {
                setIsVisible(true)
                return
            }
            // 扩展的 wrapper 可能还没挂上父节点（EditorContent 初始化会搬移节点）：多等几帧
            if (attempt < MAX_POSITION_ATTEMPTS) {
                requestAnimationFrame((): void => {
                    move(attempt + 1)
                })
            }
        }
        const schedule = (): void => {
            if (frameRef.current !== null) {
                return
            }
            frameRef.current = requestAnimationFrame((): void => {
                frameRef.current = null
                move()
            })
        }
        // 滚动时块相对容器整体位移，位置必须立刻跟上；过渡要临时关掉，否则会拖出一条尾巴
        const scroller = editor.view.dom.closest<HTMLElement>(`.${EDITOR_SCROLL_CLASS}`)
        const onScroll = (): void => {
            const handle = findHandleElement(editor)
            if (handle !== null) {
                handle.dataset.scrolling = 'true'
            }
            if (scrollTimerRef.current !== null) {
                window.clearTimeout(scrollTimerRef.current)
            }
            scrollTimerRef.current = window.setTimeout((): void => {
                scrollTimerRef.current = null
                const current = findHandleElement(editor)
                if (current !== null) {
                    delete current.dataset.scrolling
                }
            }, SCROLL_SETTLE_MS)
            schedule()
        }
        // 挂载时扩展的 wrapper 可能还没挂到父节点，延后一帧再定位
        scheduleRef.current = schedule
        schedule()
        editor.on('selectionUpdate', schedule)
        editor.on('focus', schedule)
        scroller?.addEventListener('scroll', onScroll, { passive: true })
        // 窗口尺寸变化会改变正文左边缘与首行高度，位置必须重算
        window.addEventListener('resize', schedule)
        return (): void => {
            isDisposed = true
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current)
                frameRef.current = null
            }
            if (scrollTimerRef.current !== null) {
                window.clearTimeout(scrollTimerRef.current)
                scrollTimerRef.current = null
            }
            editor.off('selectionUpdate', schedule)
            editor.off('focus', schedule)
            scroller?.removeEventListener('scroll', onScroll)
            window.removeEventListener('resize', schedule)
            scheduleRef.current = null
        }
    }, [editor])

    // 菜单开合：拖拽锁与定位冻结统一在这里处理；关闭后 ref 先复位再补算，避免补算被自己拦掉
    useEffect(() => {
        isMenuOpenRef.current = isMenuOpen
        setDragLocked(editor, isMenuOpen)
        if (!isMenuOpen) {
            scheduleRef.current?.()
        }
    }, [editor, isMenuOpen])

    // 卸载时兜底解锁：菜单开着被移除（例如源模式切换）时不会再触发 onOpenChange
    useEffect(() => {
        return (): void => {
            setDragLocked(editor, false)
        }
    }, [editor])

    const schedule = useCallback((): void => {
        scheduleRef.current?.()
    }, [])

    const reveal = useCallback((): void => {
        setIsVisible(true)
    }, [])

    return { blockPosRef, lastBlockPosRef, isVisible, schedule, reveal }
}
