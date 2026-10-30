/**
 * 带内联芯片的富文本输入区：命令、上下文、词条等「引用意图」以芯片嵌在正文流中，文本紧贴芯片且换行回到行首。
 * 复用约定：芯片取 @components/ui/badge（secondary 变体），移除入口用 @webview/components/Button 的 ghost，
 * 参考图缩略图大图取 ./Image 与 @components/ui/tooltip；DOM 读写与光标操作统一复用 ./richText，
 * 芯片标记同样走 data-chip；编辑区与占位的排版常量对外导出，AI 对话与生图两处底栏输入区共用同一份，
 * 保证字号、最大高度与滚动条行为不分叉。
 * 关键约束：芯片 contentEditable=false 且不计入正文，正文内容由调用方在发送瞬间拼装；
 * 悬停提示二选一——preview 出大图、hint 出文本，preview 优先，移除按钮保留自己的提示，两个气泡互不干扰；
 * 移除语义可由芯片自带的 onRemove 覆盖（如命令芯片走「取消命令」），缺省回落 onRemoveChip(id)；
 * badgeClassName 交给 cn 合并，调用方用 max-w-* 覆盖默认宽度时不会出现两个同类名并存；
 * 外部改值（增强 / 还原 / 清空）会重写文本节点，用户输入不重写以避免光标跳动；
 * 芯片后保留一个空格文本节点作为光标占位（全空白不计入正文，外部空值不覆盖占位）；
 * Enter 发送、Shift+Enter 换行，中文输入法组词期间不拦截 Enter，粘贴统一降级为纯文本。
 */
import { cn } from 'cn'
import { X } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { Badge } from '@components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { Button, TOOLTIP_CLASS } from '@webview/components/Button'
import { Image } from './Image'
import type {
    ClipboardEvent as ReactClipboardEvent,
    JSX,
    KeyboardEvent as ReactKeyboardEvent,
    ReactNode,
    Ref,
} from 'react'
import {
    findAdjacentChip,
    insertPlainText,
    isChip,
    moveCaretToEnd,
    readEditableText,
    writeEditableText,
} from '../shared/utils/richText'

/** 芯片容器基础排版：默认宽度上限 max-w-56，调用方经 badgeClassName 覆盖 */
const CHIP_CLASS = 'mr-1 h-5 max-w-56 align-top'

/** 芯片悬停预览：目前只用于参考图，src 由调用方给出的 webview 地址，组件不读磁盘 */
export interface RichChipPreview {
    src: string
    alt: string
}

export interface RichChip {
    /** 芯片标识：相邻退格删除时按此回调，移除按钮也用它定位 */
    id: string
    label: string
    /** 前置图标，尺寸由组件统一约束 */
    icon?: ReactNode
    /** 悬停文件名时展示的大图：与 hint 二选一，优先于 hint */
    preview?: RichChipPreview
    /** 悬停文件名时展示的文本提示：如上下文引用的 @zhai 存储根路径 */
    hint?: string
    /** 文本后的副信息（字数、条数等）：缺省或空串不渲染 */
    meta?: string
    /** 芯片容器补充类名：如命令芯片用 max-w-40 覆盖默认宽度 */
    badgeClassName?: string
    /** 移除按钮的提示与无障碍名：缺省为「移除{label}」 */
    removeLabel?: string
    /** 自定义移除语义（如取消命令）：缺省回落 onRemoveChip(id) */
    onRemove?: () => void
}

/** 对外暴露的命令式能力：词库、模板等需要往光标处插入文本 */
export interface RichChipInputHandle {
    insertText: (text: string) => void
    focus: () => void
}

/**
 * 编辑区排版：底栏输入框的唯一来源，调用方传 className 时整块替换。
 * 对外导出给同处底栏的输入区共用，避免两处在字号、滚动条与最大高度上再次分叉。
 */
export const RICH_EDITOR_CLASS =
    'no-scrollbar max-h-40 min-h-17 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm leading-5 outline-none'

/** 占位文案排版：与正文同字号，否则提示字比输入字大一号 */
export const RICH_PLACEHOLDER_CLASS = 'pointer-events-none absolute top-0 left-0 text-sm text-muted-foreground'

/** 把芯片统一前置：React 新增节点会追加到既有文本之后，这里拉回「芯片在前、正文在后」的阅读顺序 */
function hoistChips(host: HTMLDivElement): void {
    const nodes = Array.from(host.childNodes)
    const chipNodes = nodes.filter(isChip)
    const firstBody = nodes.find((node) => !isChip(node))
    if (firstBody !== undefined) {
        chipNodes.forEach((chip) => host.insertBefore(chip, firstBody))
    }
}

/** 芯片后补一格空白承载光标；没有芯片时清掉残留占位，避免光标空走一格 */
function syncCaretPlaceholder(host: HTMLDivElement): void {
    const chipNodes = Array.from(host.childNodes).filter(isChip)
    const body = readEditableText(host)
    if (chipNodes.length === 0) {
        if (body.length > 0 && body.trim().length === 0) {
            writeEditableText(host, '')
        }
        return
    }
    if (body.length === 0) {
        host.appendChild(document.createTextNode(' '))
        moveCaretToEnd(host)
    }
}

/** 移除芯片：芯片自带回调优先（如命令芯片走取消命令），否则回落统一回调 */
function removeChip(chip: RichChip, onRemoveChip: (id: string) => void): void {
    if (chip.onRemove !== undefined) {
        chip.onRemove()
        return
    }
    onRemoveChip(chip.id)
}

interface ChipLabelProps {
    chip: RichChip
}

/** 芯片文本：有 preview 出大图、只有 hint 出文本提示，两者都缺省时不挂浮层 */
function ChipLabel({ chip }: ChipLabelProps): JSX.Element {
    const label = <span className="min-w-0 truncate text-sm">{chip.label}</span>
    if (chip.preview === undefined && chip.hint === undefined) {
        return label
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>{label}</TooltipTrigger>
            <TooltipContent
                side="top"
                className={chip.preview === undefined ? cn(TOOLTIP_CLASS, 'max-w-72 text-white') : 'w-56 p-1'}
            >
                {chip.preview === undefined ? (
                    <span className="break-all">{chip.hint}</span>
                ) : (
                    // 预览沿用提示气泡的暗底，只把内边距收窄；箭头与底色同源，不需要额外处理
                    <Image
                        src={chip.preview.src}
                        alt={chip.preview.alt}
                        aspect="auto"
                        className="h-auto max-h-48 w-full rounded-sm object-contain"
                    />
                )}
            </TooltipContent>
        </Tooltip>
    )
}

interface RichChipBadgeProps {
    chip: RichChip
    disabled: boolean
    /** 移除动作：由输入区补齐「取消命令 / 移除引用」的分派与焦点回收 */
    onRemove: () => void
}

/** 单枚芯片：图标 + 文本 + 副信息 + 移除按钮，结构与 data 标记只在这里维护 */
function RichChipBadge({ chip, disabled, onRemove }: RichChipBadgeProps): JSX.Element {
    const removeLabel = chip.removeLabel ?? `移除${chip.label}`
    return (
        <Badge
            variant="secondary"
            data-chip="chip"
            data-chip-id={chip.id}
            contentEditable={false}
            className={cn(CHIP_CLASS, chip.badgeClassName)}
        >
            {chip.icon}
            <ChipLabel chip={chip} />
            {chip.meta === undefined || chip.meta.length === 0 ? null : (
                <span className="shrink-0 text-muted-foreground text-sm">{chip.meta}</span>
            )}
            <Button
                variant="ghost"
                size="icon-xs"
                className="size-4 shrink-0 text-muted-foreground"
                tooltip={removeLabel}
                aria-label={removeLabel}
                disabled={disabled}
                onClick={onRemove}
            >
                <X className="size-3" />
            </Button>
        </Badge>
    )
}

interface RichChipInputProps {
    /** 可编辑正文：不含芯片文案 */
    value: string
    chips: readonly RichChip[]
    placeholder: string
    disabled?: boolean
    canSend: boolean
    /** 输入区高度等排版类：由调用方决定单行还是多行 */
    className?: string
    onChange: (value: string) => void
    onSend: () => void
    onRemoveChip: (id: string) => void
    /** 命令式句柄：React 19 直接把 ref 当普通 prop 接收 */
    ref?: Ref<RichChipInputHandle>
}

export function RichChipInput({
    ref,
    value,
    chips,
    placeholder,
    disabled = false,
    canSend,
    className,
    onChange,
    onSend,
    onRemoveChip,
}: RichChipInputProps): JSX.Element {
    const editorRef = useRef<HTMLDivElement>(null)
    /** 中文输入法组词中：此时 Enter 用于确认候选词，不能触发发送 */
    const composingRef = useRef(false)
    /** 芯片签名：只在芯片集合变化时重排 DOM，避免每次渲染都动光标；分隔符取 NUL，避免 id 自带 `|` 时拼出重复签名 */
    const chipSignature = chips.map((chip) => chip.id).join('\u0000')

    // 外部改值（增强 / 还原 / 发送清空）时重写文本节点；用户输入时 DOM 与 value 已一致，直接跳过以免光标跳动
    useEffect(() => {
        const host = editorRef.current
        if (host === null) {
            return
        }
        const text = readEditableText(host)
        if (text === value) {
            return
        }
        // 芯片后的空格是光标占位，外部空值不应清掉它（发送清空时芯片已随渲染移除，故此判断不会拦下清空）
        if (value.length === 0 && text.trim().length === 0 && host.querySelector('[data-chip]') !== null) {
            return
        }
        writeEditableText(host, value)
        moveCaretToEnd(host)
    }, [value])

    // 芯片集合变化后重排：先统一前置，再按有无芯片补 / 清光标占位
    useEffect(() => {
        const host = editorRef.current
        if (host === null) {
            return
        }
        hoistChips(host)
        syncCaretPlaceholder(host)
    }, [chipSignature])

    const emitChange = useCallback((): void => {
        const host = editorRef.current
        if (host === null) {
            return
        }
        const text = readEditableText(host)
        // 删空后浏览器可能残留一个 <br>，此处归一为空串，保证占位提示与发送判定的稳定
        onChange(text.trim().length === 0 ? '' : text)
    }, [onChange])

    useImperativeHandle(
        ref,
        () => ({
            insertText: (text: string): void => {
                const host = editorRef.current
                if (host === null || disabled) {
                    return
                }
                host.focus()
                insertPlainText(host, text)
                emitChange()
            },
            focus: (): void => {
                editorRef.current?.focus()
            },
        }),
        [disabled, emitChange],
    )

    /** Enter 发送：Shift+Enter 交给浏览器换行；组词中的 Enter 属于输入法，不能拦截 */
    const handleEnterKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.shiftKey) {
            return
        }
        if (composingRef.current || event.nativeEvent.isComposing) {
            return
        }
        event.preventDefault()
        if (canSend) {
            onSend()
        }
    }

    /** 退格 / 删除紧邻芯片：改走状态删除，避免 DOM 删掉节点而芯片集合还在 */
    const handleChipDeleteKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const chipNode = findAdjacentChip(editorRef.current, event.key === 'Backspace' ? 'backward' : 'forward')
        const chipId = chipNode?.dataset.chipId
        const chip = chipId === undefined ? undefined : chips.find((item) => item.id === chipId)
        if (chip === undefined) {
            return
        }
        event.preventDefault()
        removeChip(chip, onRemoveChip)
    }

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter') {
            handleEnterKey(event)
            return
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
            handleChipDeleteKey(event)
        }
    }

    const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
        event.preventDefault()
        const host = editorRef.current
        if (disabled || host === null) {
            return
        }
        // 粘贴文本去掉首部换行，保证内容紧跟芯片而不是另起空行
        const text = event.clipboardData.getData('text/plain').replace(/^\n+/, '')
        if (text.length === 0) {
            return
        }
        insertPlainText(host, text)
        emitChange()
    }

    const isPlaceholderVisible = value.length === 0 && chips.length === 0

    return (
        <div className="relative">
            <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                aria-label={placeholder}
                contentEditable={!disabled}
                suppressContentEditableWarning
                className={className ?? RICH_EDITOR_CLASS}
                onInput={emitChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onCompositionStart={() => {
                    composingRef.current = true
                }}
                onCompositionEnd={() => {
                    composingRef.current = false
                    emitChange()
                }}
            >
                {chips.map((chip) => (
                    <RichChipBadge
                        key={chip.id}
                        chip={chip}
                        disabled={disabled}
                        onRemove={() => {
                            removeChip(chip, onRemoveChip)
                            editorRef.current?.focus()
                        }}
                    />
                ))}
            </div>
            {isPlaceholderVisible ? (
                // 占位文案只作视觉提示：可访问名已由编辑区的 aria-label 承担，避免读屏念两遍
                <span aria-hidden="true" className={RICH_PLACEHOLDER_CLASS}>
                    {placeholder}
                </span>
            ) : null}
        </div>
    )
}
