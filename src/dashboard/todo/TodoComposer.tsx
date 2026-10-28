/**
 * 待办输入区：单行输入框与「发布」图标按钮，提交即追加一条待办。
 * 复用约定：输入容器与操作按钮都取 @components/ui 的 input-group（input + InputGroupButton），
 * 首尾空白与超长由宿主侧 normalizeTodoText 再收口。
 * 关键约束：Enter 提交，中文输入法组字期间的回车不提交（isComposing 为真时放行）；
 * 输入框为单行，粘贴进来的换行会被浏览器折成空格，故一次只产生一条待办；
 * 提交成功才清空输入，失败保留原文便于重试；提交期间输入框被禁用，
 * 成功后的回焦必须等禁用解除（disabled 元素上的 focus 会被浏览器直接忽略），故走回焦标记 + effect。
 */
'use client'

import { SquarePen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import type { JSX, KeyboardEvent } from 'react'

export interface TodoComposerProps {
    isDisabled: boolean
    /** 提交一条待办：成功返回 true，据此清空输入 */
    onSubmit: (texts: string[]) => Promise<boolean>
}

export function TodoComposer({ isDisabled, onSubmit }: TodoComposerProps): JSX.Element {
    const [input, setInput] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    /** 回焦标记：置位后由 effect 在禁用解除时消费一次，避免在 disabled 元素上做无效 focus */
    const shouldRefocusRef = useRef(false)

    // 空白串与空串等价，trim 一次供按钮禁用与提交共用，避免两处判定漂移
    const text = input.trim()
    const isSubmitDisabled = isDisabled || text.length === 0

    useEffect(() => {
        if (!shouldRefocusRef.current || isDisabled || isSubmitting) {
            return
        }
        shouldRefocusRef.current = false
        inputRef.current?.focus()
    }, [isDisabled, isSubmitting])

    const handleSubmit = async (): Promise<void> => {
        if (isSubmitDisabled || isSubmitting) {
            return
        }
        setIsSubmitting(true)
        try {
            const isSuccess = await onSubmit([text])
            if (isSuccess) {
                setInput('')
                shouldRefocusRef.current = true
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    /** Enter 提交；输入法组字中的回车交给输入法处理 */
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
            return
        }
        event.preventDefault()
        void handleSubmit()
    }

    return (
        <InputGroup>
            <InputGroupInput
                ref={inputRef}
                value={input}
                placeholder="添加新待办"
                aria-label="添加新待办"
                disabled={isDisabled}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
            />
            <InputGroupAddon align="inline-end">
                <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    disabled={isSubmitDisabled}
                    isLoading={isSubmitting}
                    tooltip="发布"
                    onClick={() => void handleSubmit()}
                >
                    <SquarePen />
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    )
}
