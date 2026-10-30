/**
 * 文章弹窗：新建与编辑共用（标题、作者、摘要、Markdown 正文），提交后由页面补批次与文章 id 再调宿主。
 * 复用约定：骨架取 FormDialog，输入取 @components/ui/input 与 textarea，上限常量取 shared/types/wechat；
 * 标题与作者用 useTrimmedInput 判定空值，正文保留原样输入（首尾空行对排版有意义）。
 * 关键约束：正文按 Markdown 源文保存，推送前才渲染为内联样式 HTML，弹窗不承诺「所见即所得」，
 * 因此说明文案必须点明这一点；编辑来自笔记/作品的稿件时，来源只读展示，改写不会回写源文件；
 * 表单重置由页面在每次打开时更换组件 key 完成，本组件不在 effect 中写状态。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import {
    WECHAT_ARTICLE_AUTHOR_MAX,
    WECHAT_ARTICLE_BODY_MAX,
    WECHAT_ARTICLE_DIGEST_MAX,
    WECHAT_ARTICLE_TITLE_MAX,
    type WechatArticleDetail,
} from '@shared/types/wechat'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'
import { WECHAT_ARTICLE_SOURCE_LABELS } from '../utils'

/** 提交载荷：不含 id 与批次，由页面补齐 */
export interface WechatArticleDialogInput {
    title: string
    author: string
    digest: string
    body: string
}

interface WechatArticleDialogProps {
    open: boolean
    /** 编辑目标：null 表示新建 */
    article: WechatArticleDetail | null
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (input: WechatArticleDialogInput) => Promise<boolean>
}

export function WechatArticleDialog({
    open,
    article,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: WechatArticleDialogProps): JSX.Element {
    const isEditing = article !== null
    const title = useTrimmedInput(article?.title ?? '')
    const author = useTrimmedInput(article?.author ?? '')
    const digest = useTrimmedInput(article?.digest ?? '')
    const [body, setBody] = useState(article?.body ?? '')

    const handleSubmit = (): void => {
        if (title.isBlank) {
            return
        }
        void onSubmit({
            title: title.trimmedValue,
            author: author.trimmedValue,
            digest: digest.trimmedValue,
            body,
        })
    }

    return (
        <FormDialog
            open={open}
            title={isEditing ? '编辑文章' : '添加文章'}
            description="正文按 Markdown 保存，推送前统一渲染成公众号可直接发布的样式。"
            submitLabel={isEditing ? '保存' : '添加'}
            isSubmitting={isSubmitting}
            isSubmitDisabled={title.isBlank}
            contentClassName="sm:max-w-lg"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-article-title">标题</FieldLabel>
                <Input
                    id="wechat-article-title"
                    value={title.value}
                    maxLength={WECHAT_ARTICLE_TITLE_MAX}
                    placeholder="推送后显示的标题"
                    disabled={isSubmitting}
                    onChange={(event) => title.setValue(event.target.value)}
                />
                <FieldDescription>{`最多 ${String(WECHAT_ARTICLE_TITLE_MAX)} 字，超出会被公众号拒绝。`}</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-author">作者</FieldLabel>
                <Input
                    id="wechat-article-author"
                    value={author.value}
                    maxLength={WECHAT_ARTICLE_AUTHOR_MAX}
                    placeholder="可留空"
                    disabled={isSubmitting}
                    onChange={(event) => author.setValue(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-digest">摘要</FieldLabel>
                <Textarea
                    id="wechat-article-digest"
                    value={digest.value}
                    rows={2}
                    maxLength={WECHAT_ARTICLE_DIGEST_MAX}
                    placeholder="留空时取正文前若干字"
                    disabled={isSubmitting}
                    onChange={(event) => digest.setValue(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-body">正文（Markdown）</FieldLabel>
                <Textarea
                    id="wechat-article-body"
                    value={body}
                    rows={10}
                    className="max-h-64 overflow-y-auto"
                    placeholder="支持 Markdown，图片请在推送前确认本地路径可读"
                    disabled={isSubmitting}
                    onChange={(event) => setBody(event.target.value)}
                />
                <FieldDescription>
                    {isEditing && article.sourceKind !== 'manual'
                        ? `来自${WECHAT_ARTICLE_SOURCE_LABELS[article.sourceKind]}文档 ${article.sourcePath ?? ''}，改写不会回写源文件。`
                        : `共 ${String(body.length)} / ${String(WECHAT_ARTICLE_BODY_MAX)} 字。`}
                </FieldDescription>
            </Field>
        </FormDialog>
    )
}
