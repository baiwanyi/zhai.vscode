/**
 * 转发框：受控附言 + 「同时评论」开关 + 字数与发送。
 * 复用约定：结构取 shadcn 的 InputGroup（block-end 附件放字数、开关与发送），
 * 开关取 @webview/components/Switch；字数上限与超限判定由调用方算好传入
 * （纯转发 500 字、勾选同时评论后按评论上限 140 字收窄）。
 * 关键约束：附言可以为空（纯转发），按钮只在越过当前上限时禁用，其余交给 maxLength 兜住；
 * 提交中开关与输入框一起禁用，避免用户误以为本次提交带上了新选择；
 * 引用由父级追加到草稿，父级每追加一次就把 focusEndSignal 自增，这里等渲染落地后聚焦并置光标到末尾。
 */
import { CornerDownLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupTextarea,
} from '@components/ui/input-group'
import { Switch } from '@webview/components/Switch'
import type { KeyboardEvent, JSX } from 'react'

export interface RepostComposerProps {
    draft: string
    shouldComment: boolean
    /** 当前模式下的字数上限：由调用方按模式算好 */
    draftLimit: number
    isDraftOverLimit: boolean
    isSubmitting: boolean
    /** 光标定位信号：父级每追加一次引用就自增，组件据此聚焦并把光标放到草稿末尾 */
    focusEndSignal?: number
    onDraftChange: (value: string) => void
    onShouldCommentChange: (value: boolean) => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    onSubmit: () => void
}

export function RepostComposer({
    draft,
    shouldComment,
    draftLimit,
    isDraftOverLimit,
    isSubmitting,
    focusEndSignal,
    onDraftChange,
    onShouldCommentChange,
    onKeyDown,
    onSubmit,
}: RepostComposerProps): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    // 引用内容已在这次渲染里写进 value：此时再聚焦并置光标，落点才是新增内容的末尾
    useEffect(() => {
        if (focusEndSignal === undefined || focusEndSignal === 0) {
            return
        }
        const textarea = textareaRef.current
        if (textarea === null) {
            return
        }
        textarea.focus()
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
    }, [focusEndSignal])

    return (
        <InputGroup>
            <InputGroupTextarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => {
                    onDraftChange(event.target.value)
                }}
                onKeyDown={onKeyDown}
                placeholder="说点什么…留空即纯转发"
                aria-label="转发附言"
                maxLength={draftLimit}
                disabled={isSubmitting}
                className="max-h-32 min-h-14 text-xs"
            />
            <InputGroupAddon align="block-end" className="justify-between">
                <InputGroupText
                    className={isDraftOverLimit ? 'text-xs tabular-nums text-destructive' : 'text-xs tabular-nums'}
                >
                    {draft.length}/{draftLimit}
                    {isDraftOverLimit ? '（超出上限）' : ''}
                </InputGroupText>
                <div className="flex items-center gap-2">
                    {/* 同时评论：打开即转发的同时在原博下生成一条评论（is_comment=1），附言随之按评论上限收窄 */}
                    <Switch
                        size="sm"
                        checked={shouldComment}
                        onCheckedChange={onShouldCommentChange}
                        label="同时评论"
                        disabled={isSubmitting}
                    />
                    <InputGroupButton
                        variant="primary"
                        tooltip="发布"
                        disabled={isDraftOverLimit}
                        isLoading={isSubmitting}
                        onClick={onSubmit}
                    >
                        <CornerDownLeft />
                    </InputGroupButton>
                </div>
            </InputGroupAddon>
        </InputGroup>
    )
}
