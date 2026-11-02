/**
 * 文章设置弹窗：只改发布元信息（作者、摘要、允许留言），正文与标题不在此处。
 * 复用约定：骨架取 FormDialog，字段取 @components/ui 的 field / input / textarea，开关取 components/Switch，
 * 长度上限取 shared/types/wechat，与工作流面板的同一份口径。
 * 关键约束：作者留空表示不填，摘要留空时推送阶段回退正文前若干字；
 * 标题与封面原样回传（契约要求标题必填），避免本入口改动正文文件；
 * 草稿只存在于本次打开期间，调用方须以文章 id 作为 key 重建组件。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { WECHAT_ARTICLE_AUTHOR_MAX, WECHAT_ARTICLE_DIGEST_MAX, type WechatArticleSummary } from '@shared/types/wechat'
import { FormDialog } from '@webview/components/FormDialog'
import { Switch } from '@webview/components/Switch'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

interface WechatArticleMetaDialogProps {
    /** 目标文章：以它当前的元信息作为初始草稿 */
    article: WechatArticleSummary
    /** 作者默认值：文章没填作者时用最近一次设置过的作者，减少重复输入 */
    defaultAuthor: string
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    /** 保存：返回 false 表示失败，弹窗保持打开 */
    onSubmit: (input: { author: string; digest: string; allowComment: boolean }) => Promise<boolean>
}

export function WechatArticleMetaDialog({
    article,
    defaultAuthor,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: WechatArticleMetaDialogProps): JSX.Element {
    const author = useTrimmedInput(article.author ?? defaultAuthor)
    const digest = useTrimmedInput(article.digest ?? '')
    const [isCommentAllowed, setIsCommentAllowed] = useState(article.allowComment)

    const handleSubmit = (): void => {
        void onSubmit({
            author: author.trimmedValue,
            digest: digest.trimmedValue,
            allowComment: isCommentAllowed,
        }).then((isSaved) => {
            if (isSaved) {
                onOpenChange(false)
            }
        })
    }

    return (
        <FormDialog
            open
            title="文章设置"
            description="只影响推送时写入公众号的元信息，正文在批次目录的 Markdown 文件里维护。"
            submitLabel="保存"
            isSubmitting={isSubmitting}
            contentClassName="sm:max-w-md"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-article-meta-author">作者</FieldLabel>
                <Input
                    id="wechat-article-meta-author"
                    value={author.value}
                    maxLength={WECHAT_ARTICLE_AUTHOR_MAX}
                    placeholder="可留空"
                    disabled={isSubmitting}
                    onChange={(event) => author.setValue(event.target.value)}
                />
                <FieldDescription>{`最多 ${String(WECHAT_ARTICLE_AUTHOR_MAX)} 字；留空时用最近设置过的作者`}</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-meta-digest">摘要</FieldLabel>
                <Textarea
                    id="wechat-article-meta-digest"
                    value={digest.value}
                    rows={3}
                    maxLength={WECHAT_ARTICLE_DIGEST_MAX}
                    placeholder="留空时取正文前若干字"
                    disabled={isSubmitting}
                    onChange={(event) => digest.setValue(event.target.value)}
                />
                <FieldDescription>{`最多 ${String(WECHAT_ARTICLE_DIGEST_MAX)} 字`}</FieldDescription>
            </Field>
            <Field>
                <FieldLabel>读者留言</FieldLabel>
                <div className="flex items-center">
                    <Switch
                        id="wechat-article-meta-comment"
                        checked={isCommentAllowed}
                        disabled={isSubmitting}
                        label="允许读者留言"
                        onCheckedChange={(checked) => setIsCommentAllowed(checked === true)}
                    />
                </div>
                <FieldDescription>
                    需账号已开通留言功能；未开通时平台侧不会生效，草稿仍会写入开启标记。
                </FieldDescription>
            </Field>
        </FormDialog>
    )
}
