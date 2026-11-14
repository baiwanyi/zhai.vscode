/**
 * 块把手：拖拽手柄与插入按钮常驻并列，位置沿正文左侧的一条竖线随光标块滑动。
 * 复用约定：DragHandle 负责悬停定位与整块拖拽，定位调度在 useHandlePosition、测量在 handlePosition，
 * 两个菜单各自成组件（InsertBlockMenu / BlockMenu），本文件只做装配与菜单目标冻结。
 * 关键约束：容器总占位固定为 3.75rem（w-14 + pr-2），行号偏移与版心左留白都按这个宽度排，改宽度要同步两处；
 * 定位基准是「正文左边缘 + 块首行高度」而不是块的文本矩形：块内有 padding（引用、列表）时把手不会左右漂；
 * 定位配置必须是模块级常量，内联对象每次渲染都会换引用，DragHandle 会反复重注册插件；
 * 显示不依赖鼠标悬停：扩展写的 visibility 与 pointer-events 在 editor.css 里被一并覆盖、改由内容透明度控制，
 * 点击命中必须由内层容器显式给 pointer-events——只覆盖 visibility 会留下「看得见却点不动」的把手；
 * 两个菜单共用一个「有菜单打开」的判断：同时锁拖拽、冻结把手定位，关闭后补算一次位置；
 * 块菜单的目标块由「最近一次非空悬停位置」冻结——鼠标移到把手上时扩展给的是 null，现读会丢目标。
 */
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { cn } from 'cn'
import { GripVertical } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@webview/components/Button'
import { BlockMenu } from './BlockMenu'
import { readTopBlockPos } from './blockQueries'
import { HANDLE_WRAPPER_CLASS, handleAnchorRect, positionHandleAt } from './handlePosition'
import { InsertBlockMenu } from './InsertBlockMenu'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { ComponentProps, JSX } from 'react'
import { focusEditor } from '../focusPolicy'
import { useHandlePosition } from '../hooks/useHandlePosition'

export interface BlockHandleProps {
    editor: Editor
    /** 询问 AI：块菜单里触发，把该块文本交给编辑器现有的查询弹窗 */
    onAskAi: (quote: string) => void
    /** 加入 AI 对话：块菜单里触发，把该块文本与顶层序号交给宿主写入工作流区对话上下文 */
    onAddToChat: (quote: string, blockIndex: number) => void
}

/** 把手容器：总占位 3.75rem（w-14 + pr-2），两个 20px 图标槽并排常驻，留出余量避免被 flex 挤压变形 */
const HANDLE_CLASS = 'flex w-14 shrink-0 items-center pr-2'

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

/** DragHandle 的悬停回调入参：node 为 null 表示鼠标不在任何块上 */
interface DragHandleNodeChange {
    node: ProseMirrorNode | null
    pos: number
}

export function BlockHandle({ editor, onAskAi, onAddToChat }: BlockHandleProps): JSX.Element {
    // 插入菜单与块菜单各自开合：任一打开都要同时锁拖拽并冻结定位
    const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false)
    const [isBlockMenuOpen, setIsBlockMenuOpen] = useState(false)
    // 块菜单的目标块：打开瞬间冻结，菜单内所有命令都以它为准
    const [menuTargetPos, setMenuTargetPos] = useState<number | null>(null)
    const isMenuOpen = isInsertMenuOpen || isBlockMenuOpen
    const { blockPosRef, lastBlockPosRef, isVisible, schedule, reveal } = useHandlePosition(editor, isMenuOpen)

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
    const handleNodeChange = ({ node, pos }: DragHandleNodeChange): void => {
        blockPosRef.current = node === null ? null : pos
        if (node !== null) {
            // 只记非空值：鼠标移到把手上时扩展给的是 null，块菜单打开时还得靠这条记录定位目标块
            lastBlockPosRef.current = pos
            reveal()
            schedule()
        }
    }

    /** 拖放结束：块的顺序与位置都变了，等一帧按新文档重新校准 */
    const handleDragEnd = (): void => {
        requestAnimationFrame((): void => {
            positionHandleAt(editor, blockPosRef.current)
        })
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

    return (
        <DragHandle
            editor={editor}
            className={HANDLE_WRAPPER_CLASS}
            computePositionConfig={HANDLE_POSITION}
            getReferencedVirtualElement={getReferencedElement}
            onNodeChange={handleNodeChange}
            onElementDragEnd={handleDragEnd}
        >
            <div
                className={cn(
                    HANDLE_CLASS,
                    'transition-opacity duration-150',
                    // pointer-events 必须显式双向写：外层 .drag-handle 恒为 none（见 editor.css），
                    // 只有内层 auto 才能恢复命中；隐藏态再关掉，透明把手才不会挡正文
                    isVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
                )}
            >
                <InsertBlockMenu editor={editor} isOpen={isInsertMenuOpen} onOpenChange={setIsInsertMenuOpen} />
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
                        onClosed={(): void => {
                            // 关闭后焦点必须交回正文：菜单与浮层随后都被卸载，不主动聚焦用户就无法继续输入
                            focusEditor(editor)
                        }}
                        onAskAi={onAskAi}
                        onAddToChat={onAddToChat}
                    />
                </div>
            </div>
        </DragHandle>
    )
}
