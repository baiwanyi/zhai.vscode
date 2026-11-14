/**
 * 选中文本浮动菜单：询问 AI、选中行加入对话、划线色板、块类型、行内格式、批注与更多操作。
 * 只在选中文字时出现——单击正文、单击已有划线或链接都不弹，保持编辑器常规交互。
 * 复用约定：浮层用 shadcn Popover（锚点为零尺寸 fixed 元素），按钮用 src/components 的 Button，
 * 色板与划线动作由 useAnnotations 统一处理落库与装饰，格式命令与块转换分别取自
 * toolbar/formatCommands 与 blocks/blockQueries，复制走 @shared/utils/clipboard。
 * 关键约束：点按钮必须阻止默认行为，否则 webview 失焦会让选区塌陷、复制内容变空；
 * 工具条挂在选区末行下方（锚点取底边），不压住正在读的那一行；
 * 「划线」点一下即按当前颜色落笔，色板随后浮起供改色——不要求先选色再划线；
 * 色板以绝对定位浮在该按钮正下方、选中颜色后自动收起：
 * 它不参与工具条的文档流，展开时工具条位置纹丝不动，也不会向下盖住正文；
 * 色板在同一浮层内展开，不嵌套第二个 Popover——嵌套 Portal 会抢焦点并丢选区；
 * 块类型与更多菜单是独立 Portal，点击它们会被 Popover 判为外部点击，开着菜单时不能顺手关浮层；
 * 两个子菜单自持开合状态，父层不再为它们存 state——工具条按选区重挂载，状态自然复位；
 * 链接输入框与色板同一套浮层机制：绝对定位挂在链接按钮下方，工具条不换形、不位移；
 * 链接输入态必须放开 mousedown 的默认行为，否则输入框无法聚焦、也无法选中文字；
 * 工具条按选区范围作 key 重挂载，换一段文字后输入态与菜单不会残留到新选区上；
 * 「加入对话」只交出去块序号与文本，行号换算、引用去重与跳转都在宿主侧完成，
 * 选中某行的一部分时按所在块取整行范围（口径见 readSelectionBlockRange）。
 */
import { cn } from 'cn'
import { Check, CornerDownLeft, Highlighter, MessageSquareText, Trash } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText,
} from '@components/ui/input-group'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { Separator } from '@components/ui/separator'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_PALETTE } from '@shared/utils/highlightPalette'
import { Button } from '@webview/components/Button'
import { AiActions } from './AiActions'
import { BlockTypeMenu } from './BlockTypeMenu'
import { CopyButton } from './CopyButton'
import { InlineFormatGroup } from './InlineFormatGroup'
import { SelectionMoreMenu } from './SelectionMoreMenu'
import type { SelectionBlockRange } from '../blocks/blockQueries'
import type { FrozenRange, InlineFormatId } from '../toolbar/formatCommands'
import type { Editor } from '@tiptap/react'
import type { JSX } from 'react'
import { FLOATING_POPOVER_CLASS } from '../domContracts'
import { useLinkEditor } from '../hooks/useLinkEditor'
import { useSelectionToolbar } from '../hooks/useSelectionToolbar'
import { ensureEditable } from '../toolbar/editableGuard'
import { hasOwnHrefPrefix, LINK_INPUT_MAX_LENGTH } from '../toolbar/formatCommands'
import { findHighlightColor } from '../toolbar/selectionHighlight'

/** 浮层内的单个视觉块：色板与工具条各自成块，靠间隙分开而不是共用一张底 */
const FLOATING_BLOCK_CLASS = 'rounded-lg bg-popover shadow-md'

export interface SelectionToolbarProps {
    editor: Editor | null
    /** 当前文档的标注：色板据此显示选区上真实划线的颜色，缺省按默认色处理 */
    highlights: readonly AnnotationRecord[]
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
    /** 加入对话：选中文本 + 覆盖的快照块范围，由宿主换算成整行范围的引用 */
    onAddToChat: (quote: string, blockRange: SelectionBlockRange) => void
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

/** 链接输入面板：浮在链接按钮下方，https:// 由左侧固定前缀给出，用户只填网址 */
function LinkEditor({ value, hasLink, onChange, onApply, onRemove, onCancel }: LinkEditorProps): JSX.Element {
    // 自带协议或路径前缀时隐掉左侧固定的 https://，规则与回填共用 formatCommands 里那一份
    const hasOwnPrefix = hasOwnHrefPrefix(value)
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
                    maxLength={LINK_INPUT_MAX_LENGTH}
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

/** 工具条分隔线：竖向细线，四处共用同一套间距，改间距时只有这一处 */
function ToolbarSeparator(): JSX.Element {
    return <Separator orientation="vertical" className="mx-0.5 my-1 bg-muted" />
}

interface HighlightActionsProps {
    editor: Editor
    range: FrozenRange
    isPaletteOpen: boolean
    /** 开合色板：与链接面板互斥的规则留在外层，这里只表达意图 */
    onPaletteOpenChange: (isOpen: boolean) => void
    onHighlight: (color: HighlightColor, range: FrozenRange) => Promise<void>
    onHighlightColor: (color: HighlightColor, range: FrozenRange) => Promise<void>
    /** 选区上已有划线的颜色：没有或不确定时为 null，色板回落到默认色 */
    highlightColor: HighlightColor | null
}

/** 划线按钮与色板：点一下按当前色落笔，色板随后浮起供改色；改色接在落笔之后，不被当成再新建一条 */
function HighlightActions({
    editor,
    range,
    isPaletteOpen,
    onPaletteOpenChange,
    onHighlight,
    onHighlightColor,
    highlightColor,
}: HighlightActionsProps): JSX.Element {
    /** 本实例里用户刚点的颜色：优先于「选区上已有划线的颜色」，选区一换整条工具条重挂载即重置 */
    const [pickedColor, setPickedColor] = useState<HighlightColor | null>(null)
    const activeColor = pickedColor ?? highlightColor ?? DEFAULT_HIGHLIGHT_COLOR
    // 落笔与改色共用一条任务链：色板改色必须等落笔落库，否则 items 还是旧值，改色会被当成再新建一条
    const highlightTaskRef = useRef<Promise<void> | null>(null)

    /** 点划线按钮：按当前色落笔，同一位置已有划线则取消（不改色） */
    const handleToggle = (): void => {
        if (!ensureEditable(editor)) {
            return
        }
        highlightTaskRef.current = onHighlight(activeColor, range).catch((): void => undefined)
        onPaletteOpenChange(!isPaletteOpen)
    }

    /** 色板选色：接在任务链尾，连续点两个颜色时落库顺序与点击顺序一致 */
    const handlePick = (color: HighlightColor): void => {
        if (!ensureEditable(editor)) {
            return
        }
        setPickedColor(color)
        onPaletteOpenChange(false)
        const chain = highlightTaskRef.current ?? Promise.resolve()
        const task = chain.then(() => onHighlightColor(color, range))
        highlightTaskRef.current = task.catch((): void => undefined)
    }

    return (
        <div className="relative">
            <Button
                variant="ghost"
                size="icon-sm"
                tooltip="划线"
                aria-expanded={isPaletteOpen}
                aria-haspopup="true"
                onClick={handleToggle}
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
                    {HIGHLIGHT_PALETTE.map((item) => (
                        <Button
                            key={item.value}
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`划线 ${item.label}`}
                            aria-pressed={activeColor === item.value}
                            tooltip={item.label}
                            onClick={(): void => {
                                handlePick(item.value)
                            }}
                        >
                            <span
                                className="flex size-5 items-center justify-center rounded-full"
                                style={{ backgroundColor: item.css }}
                            >
                                {activeColor === item.value ? <Check className="size-3 text-black/60" /> : null}
                            </span>
                        </Button>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

interface ToolbarBodyProps {
    editor: Editor
    range: FrozenRange
    text: string
    blockRange: SelectionBlockRange | null
    blockPos: number | null
    blockLabel: string
    /** 选区上已有划线的颜色：色板的选中态据此显示 */
    highlightColor: HighlightColor | null
    activeFormats: readonly InlineFormatId[]
    onHighlight: (color: HighlightColor, range: FrozenRange) => Promise<void>
    onHighlightColor: (color: HighlightColor, range: FrozenRange) => Promise<void>
    onAnnotate: (quote: string, range: FrozenRange) => void
    onCommitted: () => void
    onQuery: (quote: string) => void
    onAddToChat: (quote: string, blockRange: SelectionBlockRange) => void
    onDismiss: () => void
}

/** 工具条主体：内部状态随选区范围重挂载，父层只负责锚点与关闭判定 */
function ToolbarBody({
    editor,
    range,
    text,
    blockRange,
    blockPos,
    blockLabel,
    highlightColor,
    activeFormats,
    onHighlight,
    onHighlightColor,
    onAnnotate,
    onCommitted,
    onQuery,
    onAddToChat,
    onDismiss,
}: ToolbarBodyProps): JSX.Element {
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)
    // 链接输入态整包下沉：面板显隐、地址草稿与三个写入动作都在 hook 里
    const link = useLinkEditor(editor, range, onCommitted)

    /** 色板开合：与链接面板互斥——两块浮层都挂在按钮下方，同开会互相遮挡 */
    const handlePaletteOpenChange = (nextOpen: boolean): void => {
        if (nextOpen) {
            link.cancel()
        }
        setIsPaletteOpen(nextOpen)
    }

    /** 链接按钮：打开面板前先收起色板，两块浮层都挂在按钮下方，同开会互相遮挡 */
    const handleToggleLink = (): void => {
        if (!link.isEditing) {
            setIsPaletteOpen(false)
        }
        link.toggle()
    }

    return (
        <div className={cn(FLOATING_BLOCK_CLASS, 'flex items-center gap-0.5 px-1.5 py-1')}>
            <AiActions
                text={text}
                blockRange={blockRange}
                onQuery={onQuery}
                onAddToChat={onAddToChat}
                onDismiss={onDismiss}
            />

            <ToolbarSeparator />
            <BlockTypeMenu editor={editor} pos={blockPos} label={blockLabel} onConverted={onDismiss} />
            <ToolbarSeparator />
            <InlineFormatGroup
                editor={editor}
                range={range}
                activeFormats={activeFormats}
                isLinkEditing={link.isEditing}
                onLinkToggle={handleToggleLink}
                linkPanel={
                    <div className={cn(FLOATING_BLOCK_CLASS, 'p-1.5')} data-toolbar-input>
                        <LinkEditor
                            value={link.value}
                            hasLink={link.hasLink}
                            onChange={link.change}
                            onApply={link.apply}
                            onRemove={link.remove}
                            onCancel={link.cancel}
                        />
                    </div>
                }
            />
            <ToolbarSeparator />
            <HighlightActions
                editor={editor}
                range={range}
                isPaletteOpen={isPaletteOpen}
                onPaletteOpenChange={handlePaletteOpenChange}
                onHighlight={onHighlight}
                onHighlightColor={onHighlightColor}
                highlightColor={highlightColor}
            />
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
            <ToolbarSeparator />
            <CopyButton text={text} />
            <SelectionMoreMenu editor={editor} range={range} onApplied={onDismiss} />
        </div>
    )
}

export function SelectionToolbar({
    editor,
    highlights,
    onHighlight,
    onHighlightColor,
    onAnnotate,
    onCommitted,
    onQuery,
    onAddToChat,
}: SelectionToolbarProps): JSX.Element | null {
    const { isOpen, left, top, text, range, blockRange, blockPos, blockIndex, blockLabel, activeFormats, dismiss } =
        useSelectionToolbar(editor)
    // 选区上已有划线时色板显示它的颜色；匹配不到（重复文本、跨块）一律回落默认色，不猜
    const highlightColor = useMemo(
        () => findHighlightColor(highlights, blockIndex, text),
        [blockIndex, highlights, text],
    )

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
                className={cn(FLOATING_POPOVER_CLASS, 'gap-1.5')}
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
                    blockRange={blockRange}
                    blockPos={blockPos}
                    blockLabel={blockLabel}
                    highlightColor={highlightColor}
                    activeFormats={activeFormats}
                    onHighlight={onHighlight}
                    onHighlightColor={onHighlightColor}
                    onAnnotate={onAnnotate}
                    onCommitted={onCommitted}
                    onQuery={onQuery}
                    onAddToChat={onAddToChat}
                    onDismiss={dismiss}
                />
            </PopoverContent>
        </Popover>
    )
}
