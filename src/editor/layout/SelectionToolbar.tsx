/**
 * 选中文本浮动菜单：划线色板、块类型、行内格式、批注与更多操作。
 * 只在选中文字时出现——单击正文、单击已有划线或链接都不弹，保持编辑器常规交互。
 * 复用约定：浮层用 shadcn Popover（锚点为零尺寸 fixed 元素），按钮用 src/components 的 Button，
 * 色板与划线动作由 useAnnotations 统一处理落库与装饰，格式命令与块转换分别取自
 * toolbar/formatCommands 与 blocks/blockCommands，复制走 @shared/utils/clipboard。
 * 关键约束：点按钮必须阻止默认行为，否则 webview 失焦会让选区塌陷、复制内容变空；
 * 工具条挂在选区末行下方（锚点取底边），不压住正在读的那一行；
 * 「划线」点一下即按当前颜色落笔，色板随后浮起供改色——不要求先选色再划线；
 * 色板以绝对定位浮在该按钮正下方、选中颜色后自动收起：
 * 它不参与工具条的文档流，展开时工具条位置纹丝不动，也不会向下盖住正文；
 * 色板在同一浮层内展开，不嵌套第二个 Popover——嵌套 Portal 会抢焦点并丢选区；
 * 块类型与更多菜单是独立 Portal，点击它们会被 Popover 判为外部点击，开着菜单时不能顺手关浮层；
 * 链接输入框与色板同一套浮层机制：绝对定位挂在链接按钮下方，工具条不换形、不位移；
 * 链接输入态必须放开 mousedown 的默认行为，否则输入框无法聚焦、也无法选中文字；
 * 工具条按选区范围作 key 重挂载，换一段文字后输入态与菜单不会残留到新选区上。
 */
import { cn } from 'cn'
import { Check, Copy, CornerDownLeft, Highlighter, MessageSquareText, Sparkles, Trash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText,
} from '@components/ui/input-group'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { Separator } from '@components/ui/separator'
import type { HighlightColor } from '@shared/types/editor'
import { copyToClipboard } from '@shared/utils/clipboard'
import { Button } from '@webview/components/Button'
import { BlockTypeMenu } from './BlockTypeMenu'
import { InlineFormatGroup } from './InlineFormatGroup'
import { SelectionMoreMenu } from './SelectionMoreMenu'
import type { FrozenRange, InlineFormatId } from '../toolbar/formatCommands'
import type { Editor } from '@tiptap/react'
import type { JSX } from 'react'
import { useSelectionToolbar } from '../hooks/useSelectionToolbar'
import {
    applySelectionLink,
    normalizeLinkHref,
    readSelectionLink,
    removeSelectionLink,
    toEditableHref,
} from '../toolbar/formatCommands'

/** 复制成功提示的停留时长 */
const COPIED_HINT_MS = 1200

/** 色板颜色：与装饰层共用同一枚举，按字母序展示，与 HIGHLIGHT_STYLES 的书写顺序一致 */
const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['amber', 'blue', 'coral', 'emerald', 'violet']

/** 色板圆点颜色：与 marks/annotationDecorations 的底色同源，这里不透明便于辨认 */
const SWATCH_COLORS: Readonly<Record<HighlightColor, string>> = {
    amber: 'rgb(255, 226, 122)',
    blue: 'rgb(133, 189, 255)',
    coral: 'rgb(255, 150, 160)',
    emerald: 'rgb(137, 226, 160)',
    violet: 'rgb(199, 160, 255)',
}

/** 颜色中文名：供无障碍标签与提示使用 */
const COLOR_LABELS: Readonly<Record<HighlightColor, string>> = {
    amber: '琥珀黄',
    blue: '湖蓝',
    coral: '珊瑚红',
    emerald: '青绿',
    violet: '紫罗兰',
}

/** 默认划线色：琥珀黄，最接近荧光笔在纸面上的观感，首次使用不必先选色 */
const DEFAULT_COLOR: HighlightColor = 'amber'

/** 浮层内的单个视觉块：色板与工具条各自成块，靠间隙分开而不是共用一张底 */
const FLOATING_BLOCK_CLASS = 'rounded-lg bg-popover shadow-md'

export interface SelectionToolbarProps {
    editor: Editor | null
    /** 划线：同一位置已有划线时取消，由调用方实现 toggle；range 是菜单冻结的范围 */
    onHighlight: (color: HighlightColor, range: FrozenRange) => Promise<void>
    /** 划线改色：同一位置已有划线只更新颜色，没有才新建（不做 toggle） */
    onHighlightColor: (color: HighlightColor, range: FrozenRange) => Promise<void>
    /** 批注：把选中文档与范围交给弹窗填写正文 */
    onAnnotate: (quote: string, range: FrozenRange) => void
    /** 链接改动后立即落盘：不等 500ms 防抖，避免浮层操作被当成「没保存」 */
    onCommitted: () => void
    /** 查询：把选中文本交给 AI 查询弹窗 */
    onQuery: (quote: string) => void
}

interface LinkEditorProps {
    value: string
    /** 选区上已有链接：显示「移除链接」 */
    hasLink: boolean
    onChange: (value: string) => void
    onApply: () => void
    onRemove: () => void
    onCancel: () => void
}

/** 输入自带协议、或以 / # . 起头时，左侧固定前缀会与内容重复，此时把它隐掉 */
const HREF_OWN_PREFIX = /^(?:[a-z][a-z0-9+.-]*:|\/|#|\.)/iu

/** 链接输入面板：浮在链接按钮下方，https:// 由左侧固定前缀给出，用户只填网址 */
function LinkEditor({ value, hasLink, onChange, onApply, onRemove, onCancel }: LinkEditorProps): JSX.Element {
    const hasOwnPrefix = HREF_OWN_PREFIX.test(value)
    return (
        <div className="w-80 flex items-center gap-2" data-toolbar-input>
            <InputGroup>
                {hasOwnPrefix ? null : (
                    <InputGroupAddon>
                        <InputGroupText>https://</InputGroupText>
                    </InputGroupAddon>
                )}
                <InputGroupInput
                    autoFocus
                    value={value}
                    maxLength={2048}
                    placeholder="example.com/page"
                    aria-label="链接地址"
                    onChange={(event): void => {
                        onChange(event.target.value)
                    }}
                    onKeyDown={(event): void => {
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            onApply()
                            return
                        }
                        if (event.key === 'Escape') {
                            // 只收起输入面板：不拦住冒泡会一路传到 window，
                            // 被 useSelectionToolbar 的 Esc 当成「关闭整个工具条」
                            event.preventDefault()
                            event.stopPropagation()
                            onCancel()
                        }
                    }}
                />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="应用链接" tooltip="应用链接" onClick={onApply}>
                        <CornerDownLeft />
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
            <Button variant="ghost" size="icon-sm" tooltip="移除链接" disabled={!hasLink} onClick={onRemove}>
                <Trash />
            </Button>
        </div>
    )
}

interface ToolbarBodyProps {
    editor: Editor
    range: FrozenRange
    text: string
    blockPos: number | null
    blockLabel: string
    activeFormats: readonly InlineFormatId[]
    onHighlight: (color: HighlightColor, range: FrozenRange) => Promise<void>
    onHighlightColor: (color: HighlightColor, range: FrozenRange) => Promise<void>
    onAnnotate: (quote: string, range: FrozenRange) => void
    onCommitted: () => void
    onQuery: (quote: string) => void
    onDismiss: () => void
}

/** 工具条主体：内部状态随选区范围重挂载，父层只负责锚点与关闭判定 */
function ToolbarBody({
    editor,
    range,
    text,
    blockPos,
    blockLabel,
    activeFormats,
    onHighlight,
    onHighlightColor,
    onAnnotate,
    onCommitted,
    onQuery,
    onDismiss,
}: ToolbarBodyProps): JSX.Element {
    const [isCopied, setIsCopied] = useState(false)
    // 复制提示的计时器：连点要重置起点，卸载要清掉
    const copyTimerRef = useRef<number | null>(null)
    const [activeColor, setActiveColor] = useState<HighlightColor>(DEFAULT_COLOR)
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)
    const [isLinkEditing, setIsLinkEditing] = useState(false)
    const [linkValue, setLinkValue] = useState('')
    // 选区上是否真有链接：删除入口只认它，不能跟着输入框里的草稿走
    const [hasExistingLink, setHasExistingLink] = useState(false)
    const [isBlockMenuOpen, setIsBlockMenuOpen] = useState(false)
    const [isMoreOpen, setIsMoreOpen] = useState(false)

    const handleCopy = async (): Promise<void> => {
        const isOk = await copyToClipboard(text)
        if (!isOk) {
            toast.error('复制失败，请检查剪贴板权限')
            return
        }
        setIsCopied(true)
        // 连点会重复排队：先清旧计时，提示从最后一次点击起算
        if (copyTimerRef.current !== null) {
            window.clearTimeout(copyTimerRef.current)
        }
        copyTimerRef.current = window.setTimeout((): void => {
            copyTimerRef.current = null
            setIsCopied(false)
        }, COPIED_HINT_MS)
    }

    // 工具条按选区重挂载：卸载时清掉计时器，回调不能落到已卸载的组件上
    useEffect((): (() => void) => {
        return (): void => {
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current)
                copyTimerRef.current = null
            }
        }
    }, [])

    // 落笔请求：色板改色要等它落库完成，否则 items 还是旧值，改色会被当成再新建一条
    const highlightTaskRef = useRef<Promise<void> | null>(null)

    /** 点划线按钮：按当前色落笔，同一位置已有划线则取消（不改色） */
    const handleToggleHighlight = (): void => {
        if (!ensureEditable()) {
            return
        }
        highlightTaskRef.current = onHighlight(activeColor, range).catch((): void => undefined)
        setIsPaletteOpen((previous) => !previous)
    }

    /** 色板选色：等落笔结束再改色，只更新颜色，不走 toggle */
    const handlePickColor = (color: HighlightColor): void => {
        if (!ensureEditable()) {
            return
        }
        setActiveColor(color)
        setIsPaletteOpen(false)
        const pending = highlightTaskRef.current ?? Promise.resolve()
        highlightTaskRef.current = null
        void pending.then(() => onHighlightColor(color, range)).catch((): void => undefined)
    }

    /** 只读文档下所有写命令都会被静默拦下：先把原因说出来，别让用户以为按钮坏了 */
    const ensureEditable = (): boolean => {
        if (editor.isEditable) {
            return true
        }
        toast.error('当前文档为只读，改动不会写回')
        return false
    }

    /** 两个子菜单各自开合：关闭判定交给外层的 pointerdown，这里只维护自身状态 */
    const handleBlockMenuOpenChange = (isOpen: boolean): void => {
        setIsBlockMenuOpen(isOpen)
    }

    const handleMoreOpenChange = (isOpen: boolean): void => {
        setIsMoreOpen(isOpen)
    }

    const handleToggleLink = (): void => {
        if (isLinkEditing) {
            setIsLinkEditing(false)
            return
        }
        if (editor.schema.marks.link === undefined) {
            toast.error('当前编辑器未启用链接')
            return
        }
        // 没有选中文字就无从套链接：静默不弹面板会让人以为按钮坏了
        if (range.from >= range.to) {
            toast.error('请先选中要加链接的文字')
            return
        }
        // 已有链接预填进来便于改地址：按菜单冻结的范围读，点击态下选区只有塌陷光标
        const href = readSelectionLink(editor, range)
        setLinkValue(toEditableHref(href))
        // 「移除链接」按选区真实状态判定：输入框清空或随手敲字都不改变它
        setHasExistingLink(href.length > 0)
        setIsLinkEditing(true)
    }

    const handleApplyLink = (): void => {
        if (!ensureEditable()) {
            return
        }
        if (range.from >= range.to) {
            toast.error('请先选中要加链接的文字')
            return
        }
        const href = normalizeLinkHref(linkValue)
        if (href === null) {
            toast.error('链接地址不可用：仅支持 http(s)、mailto 或站内路径')
            return
        }
        if (!applySelectionLink(editor, range, href)) {
            toast.error('链接未能写入：请重新选中文字后再试')
            return
        }
        setHasExistingLink(true)
        // 只收起地址面板，浮层留着：同一段文字往往还要接着划线或再改地址
        setIsLinkEditing(false)
        onCommitted()
    }

    const handleRemoveLink = (): void => {
        if (!ensureEditable()) {
            return
        }
        if (!removeSelectionLink(editor, range)) {
            toast.error('取消链接未生效：请重新选中文字后再试')
            return
        }
        setHasExistingLink(false)
        // 不 focus 也不关浮层：摘链只改 mark，抢焦点会让选区离开这段文字，
        // 浮层一关这段文字又既非链接也非划线，之后点它不会再弹
        setIsLinkEditing(false)
        onCommitted()
    }

    return (
        <div className={cn(FLOATING_BLOCK_CLASS, 'flex items-center gap-0.5 px-1.5 py-1')}>
            <Button
                variant="ghost"
                size="sm"
                onClick={(): void => {
                    onQuery(text)
                    onDismiss()
                }}
            >
                <Sparkles className="size-3.5" />
                询问 AI
            </Button>

            <Separator orientation="vertical" className="mx-0.5 my-1 bg-muted" />
            <BlockTypeMenu
                editor={editor}
                pos={blockPos}
                label={blockLabel}
                isOpen={isBlockMenuOpen}
                onOpenChange={handleBlockMenuOpenChange}
                onConverted={onDismiss}
            />
            <Separator orientation="vertical" className="mx-0.5 my-1 bg-muted" />
            <InlineFormatGroup
                editor={editor}
                range={range}
                activeFormats={activeFormats}
                isLinkEditing={isLinkEditing}
                onLinkToggle={handleToggleLink}
                linkPanel={
                    <div className={cn(FLOATING_BLOCK_CLASS, 'p-1.5')} data-toolbar-input>
                        <LinkEditor
                            value={linkValue}
                            hasLink={hasExistingLink}
                            onChange={setLinkValue}
                            onApply={handleApplyLink}
                            onRemove={handleRemoveLink}
                            onCancel={(): void => {
                                setIsLinkEditing(false)
                            }}
                        />
                    </div>
                }
            />
            <Separator orientation="vertical" className="mx-0.5 my-1 bg-muted" />
            <div className="relative">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    tooltip="划线"
                    aria-expanded={isPaletteOpen}
                    aria-haspopup="true"
                    onClick={(): void => {
                        // 先按当前色直接落笔，再开合色板供改色：不必等选完颜色才划线
                        handleToggleHighlight()
                    }}
                >
                    <Highlighter className="size-3.5" />
                </Button>
                {/* 色板脱离文档流浮在按钮下方：上方是正文，工具条也不因它展开而下沉 */}
                {isPaletteOpen ? (
                    <div
                        className={cn(
                            FLOATING_BLOCK_CLASS,
                            'absolute top-full left-1/2 z-10 mt-2 flex w-40 -translate-x-1/2 items-center justify-center gap-1.5 px-2 py-1.5',
                        )}
                    >
                        {HIGHLIGHT_COLORS.map((color) => (
                            <Button
                                key={color}
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`划线 ${COLOR_LABELS[color]}`}
                                aria-pressed={activeColor === color}
                                tooltip={COLOR_LABELS[color]}
                                onClick={(): void => {
                                    handlePickColor(color)
                                }}
                            >
                                <span
                                    className="flex size-5 items-center justify-center rounded-full"
                                    style={{ backgroundColor: SWATCH_COLORS[color] }}
                                >
                                    {activeColor === color ? <Check className="size-3 text-black/60" /> : null}
                                </span>
                            </Button>
                        ))}
                    </div>
                ) : null}
            </div>
            <Button
                variant="ghost"
                size="icon-sm"
                tooltip="批注"
                onClick={(): void => {
                    onAnnotate(text, range)
                    onDismiss()
                }}
            >
                <MessageSquareText className="size-3.5" />
            </Button>
            <Separator orientation="vertical" className="mx-0.5 my-1 bg-muted" />
            <Button
                variant="ghost"
                size="icon-sm"
                tooltip={isCopied ? '已复制' : '复制'}
                onClick={(): void => void handleCopy()}
            >
                {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <SelectionMoreMenu
                editor={editor}
                range={range}
                isOpen={isMoreOpen}
                onOpenChange={handleMoreOpenChange}
                onApplied={onDismiss}
            />
        </div>
    )
}

export function SelectionToolbar({
    editor,
    onHighlight,
    onHighlightColor,
    onAnnotate,
    onCommitted,
    onQuery,
}: SelectionToolbarProps): JSX.Element | null {
    const { isOpen, left, top, text, range, blockPos, blockLabel, activeFormats, dismiss } = useSelectionToolbar(editor)

    // 子菜单与输入框都是独立 Portal：关闭判定按 DOM 归属统一处理，
    // 不能交给 Popover 自己的 outside-click——点菜单项会被它当成「点了浮层外面」
    useEffect((): (() => void) | undefined => {
        // 浮层没开就不挂监听：否则每次点到正文都会空跑一次 dismiss，白白重渲染
        if (!isOpen) {
            return undefined
        }
        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target
            if (!(target instanceof HTMLElement)) {
                return
            }
            if (target.closest('[data-slot="popover-content"], [data-slot^="dropdown-menu"]') !== null) {
                return
            }
            dismiss()
        }
        document.addEventListener('pointerdown', handlePointerDown, true)
        return (): void => {
            document.removeEventListener('pointerdown', handlePointerDown, true)
        }
    }, [dismiss, isOpen])

    if (!isOpen || editor === null) {
        return null
    }

    return (
        <Popover open>
            <PopoverAnchor asChild>
                <div className="pointer-events-none fixed h-0 w-0" style={{ left, top }} />
            </PopoverAnchor>
            <PopoverContent
                side="bottom"
                align="center"
                collisionPadding={16}
                className="w-auto gap-1.5 border-0 bg-transparent p-0 shadow-none ring-0"
                onOpenAutoFocus={(event): void => {
                    event.preventDefault()
                }}
                onMouseDown={(event): void => {
                    // 输入框需要正常的聚焦与选词，其余区域一律阻止默认行为以保住选区
                    const target = event.target
                    if (target instanceof HTMLElement && target.closest('[data-toolbar-input]') !== null) {
                        return
                    }
                    event.preventDefault()
                }}
            >
                <ToolbarBody
                    // 选区变化即重挂载：链接输入态与子菜单不会残留到新选区上
                    key={`${String(range.from)}:${String(range.to)}`}
                    editor={editor}
                    range={range}
                    text={text}
                    blockPos={blockPos}
                    blockLabel={blockLabel}
                    activeFormats={activeFormats}
                    onHighlight={onHighlight}
                    onHighlightColor={onHighlightColor}
                    onAnnotate={onAnnotate}
                    onCommitted={onCommitted}
                    onQuery={onQuery}
                    onDismiss={dismiss}
                />
            </PopoverContent>
        </Popover>
    )
}
