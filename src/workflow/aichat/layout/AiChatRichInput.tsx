/**
 * AI 对话富文本输入区：命令与上下文芯片以内联节点嵌在正文流中，文本紧贴芯片且换行回到行首。
 * 复用同目录 commandIcons 的命令图标、../utils 的 describeContext / toContextFileName；
 * 芯片复用 ui/badge（secondary 变体），芯片内的移除入口复用 ui/button 的 ghost/icon-xs 尺寸；
 * 编辑区与占位的排版类取 @webview/components/RichChipInput 导出的常量，与生图输入卡片共用同一份。
 * 关键约束：芯片 `contentEditable=false` 且不计入文本值，指令模板由页面在发送时拼装；
 * 上下文芯片悬停文件名时以 tooltip 给出相对工作区的路径（不含盘符与绝对前缀），悬浮只包文件名、不包移除按钮；
 * 外部改值（增强 / 还原 / 清空）会重写文本节点，用户输入不重写以避免光标跳动；
 * 命令芯片后保留一个空格文本节点作为光标占位（全空白不计入正文，外部空值不覆盖该占位）；
 * Enter 发送、Shift+Enter 换行，中文输入法组词期间不拦截 Enter，粘贴统一降级为纯文本。
 */
import { FileText, TextSelect, X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { Badge } from '@components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { AiContextRef } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import { RICH_EDITOR_CLASS, RICH_PLACEHOLDER_CLASS } from '@webview/components/RichChipInput'
import {
    findAdjacentChip,
    insertPlainText,
    isChip,
    moveCaretToEnd,
    readEditableText,
    writeEditableText,
} from '@webview/components/richText'
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
                className={RICH_EDITOR_CLASS}
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
                    <Badge
                        variant="secondary"
                        data-chip="command"
                        contentEditable={false}
                        className="mr-1 h-5 max-w-40 align-top"
                    >
                        {CommandIcon === null ? null : (
                            <CommandIcon className="size-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 truncate text-sm">{command.title}</span>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 shrink-0 text-muted-foreground"
                            title="取消命令"
                            aria-label="取消命令"
                            disabled={disabled}
                            onClick={() => {
                                onClearCommand()
                                editorRef.current?.focus()
                            }}
                        >
                            <X className="size-3" />
                        </Button>
                    </Badge>
                )}
                {contexts.map((context) => (
                    <Badge
                        key={context.id}
                        variant="secondary"
                        data-chip="context"
                        data-chip-id={context.id}
                        contentEditable={false}
                        className="mr-1 h-5 max-w-56 align-top"
                    >
                        {context.kind === 'selection' ? (
                            <TextSelect className="size-3 shrink-0 text-muted-foreground" />
                        ) : (
                            <FileText className="size-3 shrink-0 text-muted-foreground" />
                        )}
                        {/* 悬浮只包文件名：移除按钮自带提示，两个气泡互不干扰 */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="min-w-0 cursor-help truncate text-sm">
                                    {toContextFileName(context)}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-72">
                                <span className="break-all">{context.displayPath}</span>
                            </TooltipContent>
                        </Tooltip>
                        <span className="shrink-0 text-muted-foreground text-sm">{describeContext(context)}</span>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-4 shrink-0 text-muted-foreground"
                            title="移除该引用"
                            aria-label="移除该引用"
                            disabled={disabled}
                            onClick={() => {
                                onRemoveContext(context.id)
                                editorRef.current?.focus()
                            }}
                        >
                            <X className="size-3" />
                        </Button>
                    </Badge>
                ))}
            </div>
            {isPlaceholderVisible ? <span className={RICH_PLACEHOLDER_CLASS}>{placeholder}</span> : null}
        </div>
    )
}
