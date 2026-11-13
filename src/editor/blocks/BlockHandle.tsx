/**
 * 块把手：拖拽手柄与插入按钮常驻并列，位置沿正文左侧的一条竖线随光标块滑动。
 * 复用约定：DragHandle 负责悬停定位与整块拖拽，DropdownMenu 负责命令，菜单项直接复用 SLASH_COMMANDS。
 * 关键约束：容器总占位固定为 3.75rem（w-14 + pr-1），行号偏移与版心左留白都按这个宽度排，改宽度要同步两处；
 * 定位基准是「正文左边缘 + 块首行高度」而不是块的文本矩形：块内有 padding（引用、列表）时把手不会左右漂；
 * 位置由光标所在块驱动，鼠标只负责触发扩展重算，两者写的是同一对 left/top；
 * 对齐基准是块的「首行矩形」而不是整块：多行段落居中对齐会让按钮掉到两行之间；
 * 定位配置必须是模块级常量，内联对象每次渲染都会换引用，DragHandle 会反复重注册插件；
 * 显示不依赖鼠标悬停：扩展写的 visibility 在 editor.css 里被覆盖成常显，显隐交给内容透明度；
 * 菜单打开期间必须锁住拖拽，否则 Radix 的 pointerdown 会被原生 dragstart 抢占；
 * 插入菜单与块菜单共用一个「有菜单打开」的判断：同时锁拖拽、冻结把手定位，关闭后补算一次位置；
 * 块菜单的目标块由「最近一次非空悬停位置」冻结——鼠标移到把手上时扩展给的是 null，现读会丢目标；
 * 插入命令先把光标移到当前块内容末尾，插入类命令因此落在当前行之后，而不是插进行内。
 */
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { cn } from 'cn'
import { CirclePlus, GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { readTopBlockPos } from './blockCommands'
import { BlockMenu } from './BlockMenu'
import type { SlashCommand } from '../toolbar/slashCommands'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { ComponentProps, JSX } from 'react'
import { SLASH_COMMANDS } from '../toolbar/slashCommands'

export interface BlockHandleProps {
    editor: Editor
    /** 询问 AI：块菜单里触发，把该块文本交给编辑器现有的查询弹窗 */
    onAskAi: (quote: string) => void
}

/** 把手容器：总占位 3.75rem（w-14 + pr-1），两个 20px 图标槽并排常驻，留出余量避免被 flex 挤压变形 */
const HANDLE_CLASS = 'flex w-14 shrink-0 items-center pt-1 pr-2'

/**
 * 把手定位：left 表示贴参考元素左侧并垂直居中，参考元素是下面算出的「块首行」。
 * middleware 必须清空：扩展默认带 offset / flip / shift，会把位置再推 8px、窄窗口下还会把把手翻到
 * 参考元素右侧，与组件自己写入的 left/top 差出一截，两块位置来回跳就没有滑动可言。
 */
const HANDLE_POSITION: NonNullable<ComponentProps<typeof DragHandle>['computePositionConfig']> = {
    placement: 'left',
    strategy: 'absolute',
    middleware: [],
}

/**
 * 块首行的视口矩形：把手要对齐第一行，不能按整块的垂直中线——
 * 多行段落若居中对齐，按钮会掉到两行文字之间，看不出它在拖哪一块。
 * 取首个文本节点的首字符测行盒；空块、图片这类没有文本的块退回整块矩形。
 */
function firstLineRect(element: HTMLElement): DOMRect {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    const text = textNode?.textContent ?? ''
    if (textNode === null || text.length === 0) {
        return element.getBoundingClientRect()
    }
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 1)
    // 部分环境（jsdom）没有 Range.getBoundingClientRect，退回整块矩形，不能让异常中断定位
    const rect =
        typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : element.getBoundingClientRect()
    return rect.height > 0 ? rect : element.getBoundingClientRect()
}

/** 正文行高：与 editor.css 的 .zhai-editor-content（line-height: 2rem）保持一致 */
const CONTENT_LINE_HEIGHT = 32

/**
 * 把手锚点矩形：水平取正文左边缘（所有顶层块都对齐在这一条线上），
 * 垂直取块首行，块内 padding 不会再把手把推向右边，滑动时只在一条竖线上走。
 */
function handleAnchorRect(editor: Editor, dom: HTMLElement): DOMRect {
    const line = firstLineRect(dom)
    const content = editor.view.dom.getBoundingClientRect()
    // 图片、表格这类没有文本的块，firstLineRect 会退回整块矩形；高度收到一行，
    // 否则把手会被垂直居中到整块中间（高图片尤其明显），没法贴住块顶部
    const height = Math.min(line.height, CONTENT_LINE_HEIGHT)
    return new DOMRect(content.left, line.top, 0, height)
}

/** 把手根节点：drag-handle 扩展把 wrapper 挂在编辑器的父节点上，常驻定位直接写它的 left/top */
function findHandleElement(editor: Editor): HTMLElement | null {
    if (editor.isDestroyed) {
        return null
    }
    const host = editor.view.dom.parentElement
    const inHost = host?.querySelector<HTMLElement>('.drag-handle') ?? null
    if (inHost !== null) {
        return inHost
    }
    // EditorContent 初始化时会整体搬移 view.dom 的兄弟节点，扩展 append 的 wrapper 可能落在
    // 已脱离文档的旧容器里；兜底到文档范围查找（editor.css 只服务 editor 入口，单实例）
    return document.querySelector<HTMLElement>('.drag-handle')
}

/**
 * 把把手移到指定块的左侧：hoverPos 是鼠标所在块（与扩展一致），为空时退回光标块。
 * left/top 必须相对 element 的 offsetParent 计算 —— 扩展创建的 wrapper 才是绝对定位的包含块，
 * 拿编辑区容器的矩形当基准会整体偏出一个版心内边距（横向差 96px、纵向差 40px）。
 * 返回是否真的写入了位置：挂载初期扩展的 wrapper 还没建好，调用方据此决定要不要显示。
 */
function positionHandleAt(editor: Editor, hoverPos: number | null): boolean {
    const handle = findHandleElement(editor)
    const pos = hoverPos ?? readTopBlockPos(editor)
    const dom = pos === null ? null : editor.view.nodeDOM(pos)
    const owner = handle?.offsetParent ?? editor.view.dom.parentElement
    const base = owner instanceof HTMLElement ? owner.getBoundingClientRect() : null
    if (handle === null || base === null || !(dom instanceof HTMLElement)) {
        return false
    }
    const rect = handleAnchorRect(editor, dom)
    const handleRect = handle.getBoundingClientRect()
    // wrapper 的内容由 portal 渲染，首帧可能还没有尺寸；此时用设计尺寸兜底，
    // 宁可位置差一两像素，也不能因为量不到宽高就让把手永远不出现
    const handleWidth = handleRect.width === 0 ? 60 : handleRect.width
    const handleHeight = handleRect.height === 0 ? 24 : handleRect.height
    handle.style.left = `${rect.left - base.left - handleWidth}px`
    handle.style.top = `${rect.top - base.top + (rect.height - handleHeight) / 2}px`
    return true
}

/**
 * 锁定 / 解锁把手拖拽：drag-handle 的 React 版扩展通过 registerPlugin 注册，命令不在 editor.commands 类型里，
 * 因此直接派发同名事务 meta；meta 不改文档，不会污染撤销栈。
 */
function setDragLocked(editor: Editor, isLocked: boolean): void {
    if (editor.isDestroyed) {
        return
    }
    editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', isLocked))
}

export function BlockHandle({ editor, onAskAi }: BlockHandleProps): JSX.Element {
    // 插入菜单与块菜单各自开合：任一打开都要同时锁拖拽并冻结定位
    const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false)
    const [isBlockMenuOpen, setIsBlockMenuOpen] = useState(false)
    // 块菜单的目标块：打开瞬间冻结，菜单内所有命令都以它为准
    const [menuTargetPos, setMenuTargetPos] = useState<number | null>(null)
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
        const move = (attempt = 0): void => {
            // 菜单开着时位置必须钉住：块菜单的子菜单以把手为锚点，把手一动手位置就跟着变
            if (isMenuOpenRef.current) {
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
            if (attempt < 9) {
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
        const scroller = editor.view.dom.closest<HTMLElement>('.zhai-editor-scroll')
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
            }, 120)
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

    const isMenuOpen = isInsertMenuOpen || isBlockMenuOpen

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

    /**
     * 定位参考元素：扩展在鼠标移动、窗口变化后按这个矩形重算位置。
     * 返回鼠标所在块的外框锚点（与组件自己写入的坐标同源），水平固定在正文左边缘。
     */
    const getReferencedElement = (): { getBoundingClientRect: () => DOMRect } | null => {
        if (editor.isDestroyed) {
            return null
        }
        return {
            getBoundingClientRect: (): DOMRect => {
                // 菜单开着时锚点必须锁在冻结的目标块上，鼠标再移到别的块也不能把菜单带走
                const pos = menuTargetPos ?? blockPosRef.current ?? readTopBlockPos(editor)
                const dom = pos === null ? null : editor.view.nodeDOM(pos)
                return dom instanceof HTMLElement ? handleAnchorRect(editor, dom) : new DOMRect()
            },
        }
    }

    /** 悬停块变化：记录鼠标块并点亮，定位失败也不影响可见性 */
    const handleNodeChange = ({ node, pos }: { node: ProseMirrorNode | null; pos: number }): void => {
        blockPosRef.current = node === null ? null : pos
        if (node !== null) {
            // 只记非空值：鼠标移到把手上时扩展给的是 null，块菜单打开时还得靠这条记录定位目标块
            lastBlockPosRef.current = pos
            setIsVisible(true)
            scheduleRef.current?.()
        }
    }

    /** 拖放结束：块的顺序与位置都变了，等一帧按新文档重新校准 */
    const handleDragEnd = (): void => {
        requestAnimationFrame((): void => {
            positionHandleAt(editor, blockPosRef.current)
        })
    }

    /** 插入菜单开合：拖拽锁与定位冻结由 isMenuOpen 的副作用统一处理 */
    const handleInsertMenuOpenChange = (isOpen: boolean): void => {
        setIsInsertMenuOpen(isOpen)
    }

    /** 块菜单开合：打开时把目标块冻结下来，关闭时清空并让把手重新贴合当前块 */
    const handleBlockMenuOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setIsBlockMenuOpen(false)
            setMenuTargetPos(null)
            return
        }
        setMenuTargetPos(lastBlockPosRef.current ?? readTopBlockPos(editor))
        setIsBlockMenuOpen(true)
    }

    /** 执行命令：把光标移到当前块之后，插入类命令不再插进行内 */
    const runCommand = (command: SlashCommand): void => {
        const pos = readTopBlockPos(editor)
        const node = pos === null ? null : editor.state.doc.nodeAt(pos)
        if (pos === null || node === null) {
            return
        }
        // 文本块落在内容末尾，块级节点（表格、图片）落到节点之后；两者都由命令自己拆分段落
        const target = node.isTextblock ? pos + node.nodeSize - 1 : pos + node.nodeSize
        editor.chain().focus(target).run()
        command.run(editor, null)
    }

    return (
        <DragHandle
            editor={editor}
            computePositionConfig={HANDLE_POSITION}
            getReferencedVirtualElement={getReferencedElement}
            onNodeChange={handleNodeChange}
            onElementDragEnd={handleDragEnd}
        >
            <div
                className={cn(
                    HANDLE_CLASS,
                    'transition-opacity duration-150',
                    isVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
            >
                <DropdownMenu open={isInsertMenuOpen} onOpenChange={handleInsertMenuOpenChange}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="w-6" tooltip="插入块">
                            <CirclePlus className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-64">
                        {SLASH_COMMANDS.map((command) => (
                            <DropdownMenuItem
                                key={command.id}
                                onSelect={(): void => {
                                    runCommand(command)
                                }}
                            >
                                <command.icon className="size-4" />
                                {command.label}
                                {/* 说明文字与 `/` 菜单同源，两处看到的项目完全一致 */}
                                <span className="ml-auto text-xs text-muted-foreground">{command.hint}</span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/*
                 * 拖拽手柄：整块 drag 由扩展挂在容器上，这里只需要一个抓手图标。
                 * 按钮不能兼任 Radix 的 Trigger——Trigger 会在 pointerdown 上 preventDefault，
                 * 原生 dragstart 就起不来；菜单的锚点改由 BlockMenu 内部一个透明层承担。
                 */}
                <div className="relative">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-grab w-6"
                        tooltip="点击打开块菜单，按住拖动"
                        aria-haspopup="menu"
                        aria-expanded={isBlockMenuOpen}
                        onClick={(): void => {
                            handleBlockMenuOpenChange(!isBlockMenuOpen)
                        }}
                    >
                        <GripVertical className="size-3.5" />
                    </Button>
                    <BlockMenu
                        editor={editor}
                        pos={menuTargetPos}
                        isOpen={isBlockMenuOpen}
                        onOpenChange={handleBlockMenuOpenChange}
                        onAskAi={onAskAi}
                    />
                </div>
            </div>
        </DragHandle>
    )
}
