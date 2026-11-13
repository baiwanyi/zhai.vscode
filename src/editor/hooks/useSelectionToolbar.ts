/**
 * 选区浮动菜单状态：把 ProseMirror 选区换算成视口坐标、冻结范围与格式快照。
 * 复用约定：坐标取 editor.view.coordsAtPos，与 shadcn Popover 的 fixed 锚点配合；
 * 关闭条件统一收敛在此（选区塌陷、过短、滚动、缩放、Esc、点击外部）；
 * 块类型取 blocks/blockCommands，激活格式取 toolbar/formatCommands，本文件不重复判定。
 * 关键约束：只有选中的文字才会弹菜单——点击、单击标注文本一律不弹，走编辑器常规交互；
 * 正文内按住鼠标的整个拖选过程都不弹，松手一拍后才结算（等 ProseMirror 落地）；
 * 指针在 webview 外松开会导致 pointerup 丢失，用 pointermove 的 buttons 位兜底纠正；
 * 锚点取选区末行底边，浮层向下弹，不覆盖正在读的那一行文字；
 * 激活态必须听 transaction——切换 mark 不改变选区，只听 selectionUpdate 会漏掉点亮；
 * 冻结的 from/to 是菜单或输入框夺焦后的唯一执行依据，命令执行时不能再现读选区；
 * 主动收起要开静默窗口：click 早于 pointerup 的结算计时器，否则点「AI 查询」后浮层会被同一次点击弹回来。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrozenRange, InlineFormatId } from '../toolbar/formatCommands'
import type { Editor } from '@tiptap/core'
import { readBlockLabel, readTopBlockPos } from '../blocks/blockCommands'
import { readActiveFormats } from '../toolbar/formatCommands'

/** 菜单最小触发长度：一两个字符的选区多半是误触 */
const MIN_SELECTION_CHARS = 2

/** 浮层已显示时的位置跟随间隔：只求解抖动，不必等太久 */
const POSITION_UPDATE_MS = 60

/** 从停止选择到浮层出现之间的等待：太短会在选词途中冒出来挡住光标 */
const SHOW_DELAY_MS = 220

/** 浮层与视口边缘的最小留白 */
const VIEWPORT_PADDING = 60

/**
 * 主动收起后的静默窗口：click 早于 pointerup 的结算计时器，
 * 点浮层里的按钮时若不做拦截，刚 dismiss 掉的浮层会被同一次点击重新弹开。
 */
const DISMISS_GRACE_MS = 350

/** 浮层的坐标与内容快照：一次选区变化整体替换，避免逐字段 setState 造成中间态 */
interface ToolbarSnapshot {
    isOpen: boolean
    left: number
    top: number
    /** 选中的纯文本：复制与后续查询共用 */
    text: string
    /** 冻结的选区范围：块类型转换与格式命令的唯一依据 */
    range: FrozenRange
    /** 选区起点所在顶层块：块类型菜单据此定位转换目标 */
    blockPos: number | null
    /** 该块的类型标签：菜单按钮上直接显示「一级标题」这类文案 */
    blockLabel: string
}

export interface SelectionToolbarState extends ToolbarSnapshot {
    /** 选区已激活的行内格式：工具条据此点亮按下态 */
    activeFormats: readonly InlineFormatId[]
    /** 主动关闭（点击外部、Esc、滚动） */
    dismiss: () => void
}

/** 空选区的占位范围：浮层关闭时无人读取，只用于满足结构完整 */
const EMPTY_RANGE: FrozenRange = { from: 0, to: 0 }

export function useSelectionToolbar(editor: Editor | null): SelectionToolbarState {
    const [snapshot, setSnapshot] = useState<ToolbarSnapshot>({
        isOpen: false,
        left: 0,
        top: 0,
        text: '',
        range: EMPTY_RANGE,
        blockPos: null,
        blockLabel: '',
    })
    const [activeFormats, setActiveFormats] = useState<readonly InlineFormatId[]>([])
    // 当前展示的范围标记：同一范围重复刷新不再重设快照，避免点浮层按钮时整条重渲染跳动
    const openKeyRef = useRef('')
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 浮层是否已弹出：决定本次选择用「久等出现」还是「快速跟随」
    const openRef = useRef(false)
    // 鼠标是否按在正文上：按住拖选期间一律不弹，松手才结算
    const isSelectingRef = useRef(false)
    // 主动收起的截止时刻：到期前所有自动求解都不再弹，避免被同一次点击立刻弹回来
    const suppressUntilRef = useRef(0)

    const dismiss = useCallback((): void => {
        openRef.current = false
        openKeyRef.current = ''
        // 点浮层里的「AI 查询」「批注」后，pointerup 的 refresh 会排在 click 之后执行，
        // 不设静默窗口的话菜单会立刻重新弹出，看起来就是「点了按钮菜单没消失」
        suppressUntilRef.current = Date.now() + DISMISS_GRACE_MS
        setSnapshot((prev) => ({ ...prev, isOpen: false }))
    }, [])

    /** 按给定范围弹出：拖选结束后统一走这里 */
    const openAt = useCallback(
        (from: number, to: number): void => {
            if (editor === null || editor.isDestroyed) {
                return
            }
            const text = editor.state.doc.textBetween(from, to, '\n').trim()
            if (text.length < MIN_SELECTION_CHARS) {
                openRef.current = false
                openKeyRef.current = ''
                setSnapshot((prev) => ({ ...prev, isOpen: false }))
                return
            }
            const nextKey = `${String(from)}:${String(to)}`
            // 同一范围重复结算（点浮层按钮后松手也会走到这里）不再重设，避免浮层忽隐忽现
            if (openRef.current && openKeyRef.current === nextKey) {
                return
            }
            const start = editor.view.coordsAtPos(from)
            const end = editor.view.coordsAtPos(to)
            const centerX = (start.left + end.right) / 2
            const left = Math.min(Math.max(centerX, VIEWPORT_PADDING), window.innerWidth - VIEWPORT_PADDING)
            const blockPos = readTopBlockPos(editor)
            const node = blockPos === null ? null : editor.state.doc.nodeAt(blockPos)
            openRef.current = true
            openKeyRef.current = nextKey
            setSnapshot({
                isOpen: true,
                left,
                // 锚点落在选区末行下方：浮层向下弹，不再压住正在读的文字
                top: Math.max(start.bottom, end.bottom) + 2,
                text,
                range: { from, to },
                blockPos,
                blockLabel: node === null ? '' : readBlockLabel(node),
            })
        },
        [editor],
    )

    /** 重新计算选区与坐标：没有选中文字就收起 */
    const refresh = useCallback((): void => {
        if (editor === null || editor.isDestroyed) {
            return
        }
        // 刚刚主动收起（点按钮 / Esc / 点外部）：这次点击带来的结算一律忽略
        if (Date.now() < suppressUntilRef.current) {
            return
        }
        const { from, to } = editor.state.selection
        if (from === to) {
            openRef.current = false
            openKeyRef.current = ''
            setSnapshot((prev) => ({ ...prev, isOpen: false }))
            return
        }
        openAt(from, to)
    }, [editor, openAt])

    useEffect(() => {
        if (editor === null) {
            return
        }
        const handleUpdate = (): void => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
            // 按住鼠标期间一律不排定：拖选到一半停手也不能冒出来挡光标
            if (isSelectingRef.current) {
                return
            }
            // 选区塌陷必须立刻收起：走防抖会让浮层在点走之后还愣一下才消失
            if (editor.state.selection.empty) {
                refresh()
                return
            }
            // 还没弹出就多等一会儿：键盘扩选时也别打断；已经显示则只需平滑跟随
            const delay = openRef.current ? POSITION_UPDATE_MS : SHOW_DELAY_MS
            timerRef.current = setTimeout((): void => {
                timerRef.current = null
                refresh()
            }, delay)
        }
        /** 正文内按下鼠标：新一轮选择开始，先收起浮层，按住期间不再弹 */
        const handlePointerDown = (): void => {
            isSelectingRef.current = true
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
            if (openRef.current) {
                openRef.current = false
                setSnapshot((prev) => ({ ...prev, isOpen: false }))
            }
        }
        /**
         * 松手才结算：等一拍让 ProseMirror 先把选区落地。
         * 不判 isSelectingRef——按住标记一旦因异常路径卡住，整场会话就再也不弹了；
         * 结算本身是幂等的，点在浮层上松手也只会把当前选区再确认一次。
         */
        const handlePointerUp = (event: PointerEvent): void => {
            isSelectingRef.current = false
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
            // Ctrl / Cmd + 点击是「打开链接」，交给正文的点击处理，不跟着弹菜单
            if (event.ctrlKey || event.metaKey) {
                return
            }
            window.setTimeout(refresh, 0)
        }
        /**
         * 兜底：指针在 webview 外松开时收不到 pointerup，按住标记会一直挂着，
         * 之后所有选区都不再弹浮层——靠 pointermove 的 buttons 位把状态纠正回来。
         */
        const handlePointerMove = (event: PointerEvent): void => {
            if (isSelectingRef.current && event.buttons === 0) {
                handlePointerUp(event)
            }
        }
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                dismiss()
            }
        }
        const dom = editor.view.dom
        dom.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', handlePointerUp)
        window.addEventListener('pointermove', handlePointerMove, { passive: true })
        editor.on('selectionUpdate', handleUpdate)
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        window.addEventListener('keydown', handleKeyDown)
        return (): void => {
            dom.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', handlePointerUp)
            window.removeEventListener('pointermove', handlePointerMove)
            editor.off('selectionUpdate', handleUpdate)
            window.removeEventListener('scroll', dismiss, true)
            window.removeEventListener('resize', dismiss)
            window.removeEventListener('keydown', handleKeyDown)
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [dismiss, editor, refresh])

    // 激活态跟随每一次事务：点「加粗」不改变选区，必须靠 transaction 补齐点亮
    useEffect(() => {
        if (editor === null) {
            return
        }
        const sync = (): void => {
            setActiveFormats((prev) => {
                const next = readActiveFormats(editor)
                // 内容相同就复用旧数组，避免每个字符都触发一次重渲染
                return prev.length === next.length && prev.every((item, index) => item === next[index]) ? prev : next
            })
        }
        sync()
        editor.on('transaction', sync)
        return (): void => {
            editor.off('transaction', sync)
        }
    }, [editor])

    return { ...snapshot, activeFormats, dismiss }
}
