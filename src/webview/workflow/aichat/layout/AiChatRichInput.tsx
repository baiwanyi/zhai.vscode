/**
 * AI 对话富文本输入区：命令与上下文芯片以内联节点嵌在正文流中，文本紧贴芯片且换行回到行首。
 * 复用同目录 commandIcons 的命令图标、../utils 的 describeContext / toContextFileName。
 * 关键约束：芯片 `contentEditable=false` 且不计入文本值，指令模板由页面在发送时拼装；
 * 外部改值（增强 / 还原 / 清空）会重写文本节点，用户输入不重写以避免光标跳动；
 * 命令芯片后保留一个空格文本节点作为光标占位（全空白不计入正文，外部空值不覆盖该占位）；
 * Enter 发送、Shift+Enter 换行，中文输入法组词期间不拦截 Enter，粘贴统一降级为纯文本。
 */
import { FileText, TextSelect, X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import type { AiContextRef } from '@shared/types/aiChat'
import { COMMAND_ICONS } from './commandIcons'
import type { AiCommand } from '../constants'
import type { ClipboardEvent as ReactClipboardEvent, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { describeContext, toContextFileName } from '../utils'

interface AiChatRichInputProps {
    /** 可编辑正文：不含芯片文案 */
    value: string
    command: AiCommand | null
    contexts: AiContextRef[]
    placeholder: string
    disabled: boolean
    canSend: boolean
    onChange: (value: string) => void
    onSend: () => void
    onClearCommand: () => void
    onRemoveContext: (id: string) => void
}

/** 判断节点是否为不可编辑芯片 */
function isChip(node: Node | null | undefined): node is HTMLElement {
    return node instanceof HTMLElement && node.dataset.chip !== undefined
}

/** 读取可编辑区纯文本：芯片文案不计入，换行由 `<br>` 还原为 `\n` */
function readEditableText(host: HTMLElement): string {
    let text = ''
    const walk = (node: Node): void => {
        if (isChip(node)) {
            return
        }
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.nodeValue ?? ''
            return
        }
        if (!(node instanceof HTMLElement)) {
            return
        }
        if (node.tagName === 'BR') {
            text += '\n'
            return
        }
        node.childNodes.forEach(walk)
    }
    host.childNodes.forEach(walk)
    return text
}

/** 用纯文本重写可编辑区（保留芯片节点），用于外部改值 */
function writeEditableText(host: HTMLElement, value: string): void {
    Array.from(host.childNodes).forEach((node) => {
        if (isChip(node)) {
            return
        }
        host.removeChild(node)
    })
    if (value.length > 0) {
        host.appendChild(document.createTextNode(value))
    }
}

/** 把光标置于可编辑区末尾：仅在编辑器已聚焦时执行，避免抢走其它输入框的焦点 */
function moveCaretToEnd(host: HTMLElement): void {
    if (document.activeElement !== host) {
        return
    }
    const selection = window.getSelection()
    if (!selection) {
        return
    }
    const range = document.createRange()
    range.selectNodeContents(host)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
}

/** 查找光标紧邻的芯片：用于 Backspace / Delete 时改走状态删除，避免 DOM 与状态不同步 */
function findAdjacentChip(host: HTMLElement | null, direction: 'backward' | 'forward'): HTMLElement | null {
    if (!host) {
        return null
    }
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        return null
    }
    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer)) {
        return null
    }
    const { startContainer, startOffset } = range
    if (startContainer.nodeType === Node.TEXT_NODE) {
        const text = startContainer.nodeValue ?? ''
        if (direction === 'backward' ? startOffset !== 0 : startOffset !== text.length) {
            return null
        }
        const sibling = direction === 'backward' ? startContainer.previousSibling : startContainer.nextSibling
        return isChip(sibling) ? sibling : null
    }
    if (startContainer !== host) {
        return null
    }
    const sibling = direction === 'backward' ? host.childNodes[startOffset - 1] : host.childNodes[startOffset]
    return isChip(sibling) ? sibling : null
}

/** 在光标处插入纯文本：选区落在芯片上时先收敛到末尾，避免连带删除芯片 */
function insertPlainText(host: HTMLElement, text: string): void {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
        host.appendChild(document.createTextNode(text))
        return
    }
    const range = selection.getRangeAt(0)
    const anchor = range.startContainer
    const isInsideChip =
        anchor instanceof HTMLElement
            ? anchor.closest('[data-chip]') !== null
            : anchor.parentElement?.closest('[data-chip]') !== null
    if (!host.contains(anchor) || isInsideChip === true) {
        host.focus()
        moveCaretToEnd(host)
        insertPlainText(host, text)
        return
    }
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
}

export function AiChatRichInput({
    value,
    command,
    contexts,
    placeholder,
    disabled,
    canSend,
    onChange,
    onSend,
    onClearCommand,
    onRemoveContext,
}: AiChatRichInputProps): JSX.Element {
    const editorRef = useRef<HTMLDivElement>(null)
    /** 中文输入法组词中：此时 Enter 用于确认候选词，不能触发发送 */
    const composingRef = useRef(false)

    // 外部改值（增强 / 还原 / 发送清空）时重写文本节点；用户输入时 DOM 与 value 已一致，直接跳过以免光标跳动
    useEffect(() => {
        const host = editorRef.current
        if (!host) {
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

    // React 新增芯片时会追加到既有文本之后，这里统一前置，保持「芯片在前、正文在后」的阅读顺序
    useEffect(() => {
        const host = editorRef.current
        if (!host) {
            return
        }
        const nodes = Array.from(host.childNodes)
        const chips = nodes.filter(isChip)
        const firstBody = nodes.find((node) => !isChip(node))
        if (firstBody !== undefined) {
            chips.forEach((chip) => host.insertBefore(chip, firstBody))
        }
        // 芯片后留一格空白承载光标：正文为空时补一个空格，避免光标紧贴芯片边框
        const body = readEditableText(host)
        if (chips.length === 0) {
            // 取消命令后残留的占位空格一并清掉，避免光标空走一格
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
    }, [command, contexts])

    const emitChange = useCallback((): void => {
        const host = editorRef.current
        if (!host) {
            return
        }
        const text = readEditableText(host)
        // 删空后浏览器可能残留一个 <br>，此处归一为空串，保证占位提示与发送判定的稳定
        onChange(text.trim().length === 0 ? '' : text)
    }, [onChange])

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter') {
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
            return
        }
        if (event.key !== 'Backspace' && event.key !== 'Delete') {
            return
        }
        const chip = findAdjacentChip(editorRef.current, event.key === 'Backspace' ? 'backward' : 'forward')
        if (chip === null) {
            return
        }
        event.preventDefault()
        if (chip.dataset.chip === 'command') {
            onClearCommand()
            return
        }
        const { chipId } = chip.dataset
        if (chipId !== undefined) {
            onRemoveContext(chipId)
        }
    }

    const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
        event.preventDefault()
        const host = editorRef.current
        if (disabled || !host) {
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

    const CommandIcon = command === null ? null : COMMAND_ICONS[command.id]
    const isPlaceholderVisible = value.length === 0 && command === null && contexts.length === 0

    return (
        <div className="relative">
            <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                aria-label={placeholder}
                contentEditable={!disabled}
                suppressContentEditableWarning
                className="no-scrollbar max-h-40 min-h-17 overflow-y-auto whitespace-pre-wrap break-words leading-5 outline-none"
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
                {command === null ? null : (
                    <span
                        data-chip="command"
                        contentEditable={false}
                        className="mr-0.5 inline-flex h-5 max-w-40 items-center gap-1 rounded-md bg-white/10 px-1.5 align-top text-foreground"
                    >
                        {CommandIcon === null ? null : (
                            <CommandIcon className="size-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 truncate">{command.title}</span>
                        <button
                            type="button"
                            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                            title="取消命令"
                            aria-label="取消命令"
                            disabled={disabled}
                            onClick={() => {
                                onClearCommand()
                                editorRef.current?.focus()
                            }}
                        >
                            <X className="size-3" />
                        </button>
                    </span>
                )}
                {contexts.map((context) => (
                    <span
                        key={context.id}
                        data-chip="context"
                        data-chip-id={context.id}
                        contentEditable={false}
                        className="mr-1 inline-flex h-5 max-w-56 items-center gap-1 rounded-md bg-white/10 px-1.5 align-top text-foreground"
                        title={context.displayPath}
                    >
                        {context.kind === 'selection' ? (
                            <TextSelect className="size-3 shrink-0 text-muted-foreground" />
                        ) : (
                            <FileText className="size-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 truncate">{toContextFileName(context)}</span>
                        <span className="shrink-0 text-muted-foreground">{describeContext(context)}</span>
                        <button
                            type="button"
                            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                            title="移除该引用"
                            aria-label="移除该引用"
                            disabled={disabled}
                            onClick={() => {
                                onRemoveContext(context.id)
                                editorRef.current?.focus()
                            }}
                        >
                            <X className="size-3" />
                        </button>
                    </span>
                ))}
            </div>
            {isPlaceholderVisible ? (
                <span className="pointer-events-none absolute top-0 left-0 text-muted-foreground">{placeholder}</span>
            ) : null}
        </div>
    )
}
