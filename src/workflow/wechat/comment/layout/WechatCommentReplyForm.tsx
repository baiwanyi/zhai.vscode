/**
 * 回复编辑区：列表行内与详情弹窗共用同一份草稿与提交入口。
 * 复用约定：表单语义取 @components/ui/field 的 FieldGroup/Field/FieldLabel/FieldDescription，
 * 多行输入取 @components/ui/textarea，按钮取 components/Button，
 * 字数上限与协议层共用 @shared/types/wechat 的 WECHAT_COMMENT_CONTENT_MAX，不另立常量。
 * 关键约束：草稿由父层持有——行内与详情可能同时可见，组件内部再存一份就会出现两份不一致的输入；
 * 标签与文本框用 useId 关联，两处同时挂载时不会出现重复 id；空内容或提交中禁用提交，
 * 成功后由父层清空草稿；取消只收起编辑区，不删除平台上已有的回复；
 * 展开即聚焦文本框，键盘用户不必再 Tab 数次才能输入，聚焦只在挂载时做一次，不抢后续焦点。
 */
'use client'

import { useEffect, useId, useRef } from 'react'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Textarea } from '@components/ui/textarea'
import { WECHAT_COMMENT_CONTENT_MAX } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface WechatCommentReplyFormProps {
    value: string
    isMutating: boolean
    /** 该留言是否已有回复：决定提交按钮文案 */
    hasReply: boolean
    onChange: (value: string) => void
    onSubmit: () => void
    onCancel: () => void
}

export function WechatCommentReplyForm({
    value,
    isMutating,
    hasReply,
    onChange,
    onSubmit,
    onCancel,
}: WechatCommentReplyFormProps): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const textareaId = useId()

    // 只在挂载时聚焦一次：提交失败或输入重渲染都不再抢焦点，避免光标跳到末尾打断编辑
    useEffect(() => {
        textareaRef.current?.focus()
    }, [])

    return (
        <FieldGroup className="gap-3">
            <Field data-disabled={isMutating || undefined}>
                <FieldLabel htmlFor={textareaId}>{hasReply ? '修改回复' : '回复'}</FieldLabel>
                <Textarea
                    ref={textareaRef}
                    id={textareaId}
                    value={value}
                    rows={3}
                    maxLength={WECHAT_COMMENT_CONTENT_MAX}
                    placeholder="读者可见的回复"
                    disabled={isMutating}
                    onChange={(event) => onChange(event.target.value)}
                />
                <FieldDescription>{`${String(value.length)}/${String(WECHAT_COMMENT_CONTENT_MAX)} 字`}</FieldDescription>
            </Field>
            <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" disabled={isMutating} onClick={onCancel}>
                    取消
                </Button>
                <Button isLoading={isMutating} disabled={value.trim().length === 0} onClick={onSubmit}>
                    {hasReply ? '更新' : '回复'}
                </Button>
            </div>
        </FieldGroup>
    )
}
