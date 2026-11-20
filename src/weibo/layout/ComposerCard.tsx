/**
 * 微博发布框：受控编辑 + 表情插入 + 字数与发布按钮，占位阶段不落盘、不请求宿主。
 * 复用约定：卡片取 @components/ui/card，表情面板取同目录 WeiboEmoticonPicker，
 * 选区插入的纯逻辑走 utils/weiboComposer，本组件只负责读写 DOM 与恢复光标。
 * 关键约束：草稿由调用方持有（首页内容随视图卸载，草稿不能跟着丢）；
 * 插入表情后由 effect 把光标落回插入位置，受控更新不打断连续输入。
 */
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@components/ui/card'
import { Button } from '@webview/components/Button'
import { WeiboEmoticonPicker } from './WeiboEmoticonPicker'
import type { JSX } from 'react'
import { insertAtSelection } from '../utils/weiboComposer'

/** 发布框字数上限：按微博普通正文限制收口，接口接入前先在前端挡住超长输入 */
const POST_MAX_LENGTH = 2000

interface ComposerCardProps {
    /** 是否已配置凭证：表情配置接口同样依赖登录 Cookie */
    isEnabled: boolean
    /** 正文草稿：由面板层持有，切换视图卸载本组件后仍能保留 */
    draft: string
    onDraftChange: (draft: string) => void
}

export function ComposerCard({ isEnabled, draft, onDraftChange }: ComposerCardProps): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    // 插入后待恢复的光标位置：受控 textarea 的值更新后由 effect 落回选区
    const pendingCaretRef = useRef<number | null>(null)
    const canPublish = draft.trim().length > 0

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

    const handleInsertEmoticon = useCallback(
        (phrase: string): void => {
            // 受控 textarea 的 value 就是草稿：直接读 DOM 省掉对 draft 的依赖，
            // 否则每敲一个字都会重建 onSelect，连表情网格一起重渲染
            const textarea = textareaRef.current
            if (textarea === null) {
                return
            }
            const result = insertAtSelection({
                value: textarea.value,
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
                insert: phrase,
                maxLength: POST_MAX_LENGTH,
            })
            if (result === null) {
                toast.info(`正文最多 ${POST_MAX_LENGTH} 字，无法再插入表情`)
                return
            }
            pendingCaretRef.current = result.caret
            onDraftChange(result.value)
        },
        [onDraftChange],
    )

    /** 发布占位：接口未接入，先给出明确反馈，避免点了没反应 */
    function handlePublish(): void {
        if (!canPublish) {
            return
        }
        toast.info('发布能力尚未接入：当前内容只停留在编辑框内')
    }

    return (
        <Card>
            <CardContent className="flex flex-col gap-2">
                <textarea
                    ref={textareaRef}
                    value={draft}
                    rows={4}
                    placeholder="分享你的新鲜事…"
                    aria-label="微博正文"
                    maxLength={POST_MAX_LENGTH}
                    onChange={(event) => {
                        onDraftChange(event.target.value)
                    }}
                    className="min-h-24 w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                    <div className="flex items-center gap-1">
                        <WeiboEmoticonPicker isEnabled={isEnabled} onSelect={handleInsertEmoticon} />
                        <span className="text-muted-foreground text-xs tabular-nums">
                            {draft.length} / {POST_MAX_LENGTH}
                        </span>
                    </div>
                    <Button variant="primary" disabled={!canPublish} onClick={handlePublish}>
                        发布
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
