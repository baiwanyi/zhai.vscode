/**
 * 标签字段：以「预设开关 + 自定义标签」两段式收集题材、禁写项这类可多值字段。
 * 复用约定：预设项用 ui/toggle 的 aria-pressed 表达选中态，自定义项用 ui/badge 承载并内嵌 ui/button
 * 的 ghost/icon-xs 移除按钮，输入框复用 ui/input 并接入全局 placeholder 令牌，不新增色值与间距体系。
 * 关键约束：回车提交须跳过中文输入法的组合态，否则选词回车会被误判为添加；
 * 达到上限时静默忽略新值并在输入框上给出提示文案，不弹窗打断填写。
 */
import { X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Input } from '@components/ui/input'
import { Toggle } from '@components/ui/toggle'
import { Button } from '@webview/components/Button'
import type { JSX, KeyboardEvent } from 'react'

interface TagFieldProps {
    inputId: string
    value: string[]
    /** 预设选项：点击加入或移除 */
    options: readonly string[]
    placeholder: string
    /** 标签上限，超过后不再接受新值 */
    max?: number
    onChange: (next: string[]) => void
}

const DEFAULT_MAX_TAGS = 8

export function TagField({
    inputId,
    value,
    options,
    placeholder,
    max = DEFAULT_MAX_TAGS,
    onChange,
}: TagFieldProps): JSX.Element {
    const [draft, setDraft] = useState('')
    const customTags = value.filter((tag) => !options.includes(tag))
    const isFull = value.length >= max

    const handleToggleOption = (option: string, isPressed: boolean): void => {
        if (isPressed && !isFull) {
            onChange([...value, option])
            return
        }
        if (!isPressed) {
            onChange(value.filter((tag) => tag !== option))
        }
    }

    const handleRemove = (tag: string): void => {
        onChange(value.filter((item) => item !== tag))
    }

    const handleCommit = (): void => {
        const next = draft.trim()
        setDraft('')
        if (next.length === 0 || value.includes(next) || isFull) {
            return
        }
        onChange([...value, next])
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
            return
        }
        event.preventDefault()
        handleCommit()
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label={placeholder}>
                {options.map((option) => (
                    <Toggle
                        key={option}
                        variant="outline"
                        pressed={value.includes(option)}
                        disabled={!value.includes(option) && isFull}
                        onPressedChange={(isPressed) => handleToggleOption(option, isPressed)}
                    >
                        {option}
                    </Toggle>
                ))}
            </div>
            {customTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {customTags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                            {tag}
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-4 shrink-0"
                                aria-label={`移除 ${tag}`}
                                onClick={() => handleRemove(tag)}
                            >
                                <X className="size-3" aria-hidden="true" />
                            </Button>
                        </Badge>
                    ))}
                </div>
            ) : null}
            <Input
                id={inputId}
                value={draft}
                aria-label={isFull ? `已达 ${max} 项上限` : placeholder}
                placeholder={isFull ? `已达 ${max} 项上限` : placeholder}
                disabled={isFull}
                className="h-7"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
            />
        </div>
    )
}
