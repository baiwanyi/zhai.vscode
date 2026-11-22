/**
 * 评论发布框：受控输入 + 回复态回显 + 表情插入 + 字数 + 「同时转发」开关 + 发布 / 回复按钮。
 * 复用约定：结构取 shadcn 的 InputGroup（block-start 附件回显回复对象，block-end 附件放字数与操作），
 * 开关取 @webview/components/Switch，字数上限取 @shared/types/weibo 的 WEIBO_COMMENT_MAX_LENGTH；
 * 表情面板取 layout/WeiboEmoticonPicker（窄区域走 icon 触发形态），选区插入走 utils/weiboComposer。
 * 关键约束：草稿、回复目标与提交态全部由调用方持有，本组件不请求也不改业务状态；
 * 表情按 [名称] 文本落到光标处，超限只提示不截断；插入后由 effect 把光标落回插入位置；
 * 回复态不提供「同时转发」——回复只能在原评论下生成子评论，不能顺带转发原博。
 */
import { CornerDownLeft } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupTextarea,
} from '@components/ui/input-group'
import { WEIBO_COMMENT_MAX_LENGTH } from '@shared/types/weibo'
import { Switch } from '@webview/components/Switch'
import type { CommentReplyTarget } from '../hooks/useWeiboCommentActions'
import type { KeyboardEvent, JSX } from 'react'
import { WeiboEmoticonPicker } from '../layout/WeiboEmoticonPicker'
import { insertAtSelection } from '../utils/weiboComposer'

export interface CommentComposerProps {
    draft: string
    replyTarget: CommentReplyTarget | null
    shouldRepost: boolean
    isSubmitting: boolean
    isDraftValid: boolean
    onDraftChange: (value: string) => void
    onShouldRepostChange: (value: boolean) => void
    onCancelReply: () => void
    onSubmit: () => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

export function CommentComposer({
    draft,
    replyTarget,
    shouldRepost,
    isSubmitting,
    isDraftValid,
    onDraftChange,
    onShouldRepostChange,
    onCancelReply,
    onSubmit,
    onKeyDown,
}: CommentComposerProps): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    // 插入后待恢复的光标位置：受控 textarea 的值更新后由 effect 落回选区
    const pendingCaretRef = useRef<number | null>(null)

    useEffect(() => {
        const caret = pendingCaretRef.current
        const textarea = textareaRef.current
        if (caret === null || textarea === null) {
            return
        }
        pendingCaretRef.current = null
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
    }, [draft])

    /** 在光标处插入表情：与发布框同一套选区逻辑，超限只提示、不截断已输入内容 */
    const handleInsertEmoticon = useCallback(
        (phrase: string): void => {
            const textarea = textareaRef.current
            if (textarea === null) {
                return
            }
            const result = insertAtSelection({
                value: textarea.value,
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
                insert: phrase,
                maxLength: WEIBO_COMMENT_MAX_LENGTH,
            })
            if (result === null) {
                toast.info(`评论最多 ${WEIBO_COMMENT_MAX_LENGTH} 字，无法再插入表情`)
                return
            }
            pendingCaretRef.current = result.caret
            onDraftChange(result.value)
        },
        [onDraftChange],
    )

    return (
        <InputGroup>
            {replyTarget === null ? null : (
                <InputGroupAddon align="block-start" className="justify-between">
                    <InputGroupText className="min-w-0 truncate">回复 @{replyTarget.authorName}</InputGroupText>
                    <InputGroupButton onClick={onCancelReply}>取消</InputGroupButton>
                </InputGroupAddon>
            )}
            <InputGroupTextarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => {
                    onDraftChange(event.target.value)
                }}
                onKeyDown={onKeyDown}
                placeholder={replyTarget === null ? '写评论…' : `回复 @${replyTarget.authorName}`}
                aria-label={replyTarget === null ? '评论内容' : `回复 @${replyTarget.authorName} 的内容`}
                maxLength={WEIBO_COMMENT_MAX_LENGTH}
                disabled={isSubmitting}
                className="max-h-32 min-h-14 text-xs"
            />
            <InputGroupAddon align="block-end" className="justify-between">
                <InputGroupText className="text-xs tabular-nums">
                    {draft.length}/{WEIBO_COMMENT_MAX_LENGTH}
                </InputGroupText>
                <div className="flex items-center gap-2">
                    {/* 评论链路本身依赖登录 Cookie，能渲染到这里即可直接取表情配置，取数失败由面板给重试 */}
                    <WeiboEmoticonPicker isEnabled triggerVariant="icon" onSelect={handleInsertEmoticon} />
                    {replyTarget === null ? (
                        <Switch
                            size="sm"
                            checked={shouldRepost}
                            onCheckedChange={onShouldRepostChange}
                            label="同时转发"
                        />
                    ) : null}
                    <InputGroupButton
                        variant="primary"
                        tooltip={replyTarget === null ? '发布' : '回复'}
                        disabled={!isDraftValid}
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
