/**
 * 带内联芯片的富文本输入区：命令、上下文等「引用意图」以芯片嵌在正文流中，文本紧贴芯片且换行回到行首。
 * 复用约定：芯片取 @components/ui/badge（secondary 变体），移除入口用 @webview/components/Button 的 ghost；
 * DOM 读写与光标操作统一复用 ./richText，芯片标记同样走 data-chip。
 * 关键约束：芯片 contentEditable=false 且不计入正文，正文内容由调用方在发送瞬间拼装；
 * 外部改值（增强 / 还原 / 清空）会重写文本节点，用户输入不重写以避免光标跳动；
 * 芯片后保留一个空格文本节点作为光标占位（全空白不计入正文，外部空值不覆盖占位）；
 * Enter 发送、Shift+Enter 换行，中文输入法组词期间不拦截 Enter，粘贴统一降级为纯文本。
 */
import { X } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@webview/components/Button'
import {
    findAdjacentChip,
    insertPlainText,
    isChip,
    moveCaretToEnd,
    readEditableText,
    writeEditableText,
} from './richText'
import type {
    ClipboardEvent as ReactClipboardEvent,
    JSX,
    KeyboardEvent as ReactKeyboardEvent,
    ReactNode,
    Ref,
} from 'react'

export interface RichChip {
    /** 芯片标识：相邻退格删除时按此回调，移除按钮也用它定位 */
    id: string
    label: string
    /** 前置图标，尺寸由组件统一约束 */
    icon?: ReactNode
}

/** 对外暴露的命令式能力：词库、模板等需要往光标处插入文本 */
export interface RichChipInputHandle {
    insertText: (text: string) => void
    focus: () => void
}

/** 默认编辑区排版：调用方传 className 时整块替换，故默认值单独成常量便于比对 */
const DEFAULT_EDITOR_CLASS =
    'no-scrollbar max-h-40 min-h-17 overflow-y-auto whitespace-pre-wrap wrap-break-word leading-5 outline-none'

interface RichChipInputProps {
    /** 可编辑正文：不含芯片文案 */
    value: string
    chips: RichChip[]
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
    /** 芯片签名：只在芯片集合变化时重排 DOM，避免每次渲染都动光标 */
    const chipSignature = chips.map((chip) => chip.id).join('|')

    useEffect(() => {
        const host = editorRef.current
        if (!host) {
            return
        }
        const text = readEditableText(host)
        if (text === value) {
            return
        }
        // 芯片后的空格是光标占位，外部空值不应清掉它（清空时芯片已随渲染移除，故不会拦下清空）
        if (value.length === 0 && text.trim().length === 0 && host.querySelector('[data-chip]') !== null) {
            return
        }
        writeEditableText(host, value)
        moveCaretToEnd(host)
    }, [value])

    // React 新增芯片时会追加到既有文本之后，这里统一前置，保持「芯片在前、正文在后」的阅读顺序
    useEffect(() => {
        const host = editorRef.current
        if (!host) {
            return
        }
        const nodes = Array.from(host.childNodes)
        const chipNodes = nodes.filter(isChip)
        const firstBody = nodes.find((node) => !isChip(node))
        if (firstBody !== undefined) {
            chipNodes.forEach((chip) => host.insertBefore(chip, firstBody))
        }
        // 移动芯片不改变正文，文本只需读一次
        const body = readEditableText(host)
        if (chipNodes.length === 0) {
            // 去掉最后一个芯片后残留的占位空格一并清掉，避免光标空走一格
            if (body.length > 0 && body.trim().length === 0) {
                writeEditableText(host, '')
            }
            return
        }
        if (body.length > 0) {
            return
        }
        host.appendChild(document.createTextNode(' '))
        moveCaretToEnd(host)
    }, [chipSignature])

    const emitChange = useCallback((): void => {
        const host = editorRef.current
        if (!host) {
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
        const chip = findAdjacentChip(editorRef.current, event.key === 'Backspace' ? 'backward' : 'forward')
        const chipId = chip?.dataset.chipId
        if (chipId === undefined) {
            return
        }
        event.preventDefault()
        onRemoveChip(chipId)
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
                className={className ?? DEFAULT_EDITOR_CLASS}
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
                    <Badge
                        key={chip.id}
                        variant="secondary"
                        data-chip="chip"
                        data-chip-id={chip.id}
                        contentEditable={false}
                        className="mr-1 h-5 max-w-56 align-top"
                    >
                        {chip.icon}
                        <span className="min-w-0 truncate text-sm">{chip.label}</span>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 shrink-0 text-muted-foreground"
                            tooltip={`移除${chip.label}`}
                            aria-label={`移除${chip.label}`}
                            disabled={disabled}
                            onClick={() => {
                                onRemoveChip(chip.id)
                                editorRef.current?.focus()
                            }}
                        >
                            <X className="size-3" />
                        </Button>
                    </Badge>
                ))}
            </div>
            {isPlaceholderVisible ? (
                // 占位文案只作视觉提示：可访问名已由编辑区的 aria-label 承担，避免读屏念两遍
                <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 text-muted-foreground">
                    {placeholder}
                </span>
            ) : null}
        </div>
    )
}
