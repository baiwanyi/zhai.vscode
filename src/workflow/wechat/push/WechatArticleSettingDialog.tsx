/**
 * 文章设置弹窗：只改发布元信息（标题、作者、摘要、封面与留言开关），正文在批次 md 文件里维护。
 * 复用约定：骨架取 components/FormDialog，字段取 @components/ui 的 field / input / textarea / checkbox，
 * 长度上限取 shared/types/wechat 与仪表盘同一口径，封面选择由调用方提供宿主协议。
 * 关键约束：草稿只存在于本次打开期间，调用方须以文章 id 作为 key 重建组件；
 * 改标题不重命名文件（路径稳定），正文不在此编辑也不随保存回写；
 * 保存期间禁用字段与按钮，成功与否由 onSubmit 的返回值决定是否关闭。
 */
import { useState } from 'react'
import { Checkbox } from '@components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import {
    WECHAT_ARTICLE_AUTHOR_MAX,
    WECHAT_ARTICLE_DIGEST_MAX,
    WECHAT_ARTICLE_TITLE_MAX,
    type WechatArticleSummary,
} from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { WechatArticleMetaInput } from '../hooks/useWechatPushOverview'
import type { JSX } from 'react'

interface WechatArticleSettingDialogProps {
    /** 目标文章：弹窗以它的当前值作为初始草稿 */
    article: WechatArticleSummary
    /** 账号设置里的默认作者：文章没填作者时作为初值 */
    defaultAuthor: string
    onOpenChange: (open: boolean) => void
    /** 保存：返回 false 表示失败，弹窗保持打开 */
    onSubmit: (input: WechatArticleMetaInput) => Promise<boolean>
    /** 选择封面：返回存储根相对路径，取消返回 null */
    onPickCover: () => Promise<string | null>
}

export function WechatArticleSettingDialog({
    article,
    defaultAuthor,
    onOpenChange,
    onSubmit,
    onPickCover,
}: WechatArticleSettingDialogProps): JSX.Element {
    const title = useTrimmedInput(article.title)
    const author = useTrimmedInput(article.author ?? defaultAuthor)
    const digest = useTrimmedInput(article.digest ?? '')
    const [coverPath, setCoverPath] = useState(article.coverPath ?? '')
    const [isCommentAllowed, setIsCommentAllowed] = useState(article.allowComment)
    const [isSaving, setIsSaving] = useState(false)

    /** 选择封面：宿主弹系统文件对话框，取消时不改动已选值 */
    const handlePickCover = (): void => {
        void onPickCover().then((path) => {
            if (path !== null) {
                setCoverPath(path)
            }
        })
    }

    const handleSubmit = (): void => {
        if (title.isBlank) {
            return
        }
        setIsSaving(true)
        void onSubmit({
            id: article.id,
            title: title.trimmedValue,
            author: author.trimmedValue,
            digest: digest.trimmedValue,
            coverPath,
            allowComment: isCommentAllowed,
        }).then((isSaved) => {
            setIsSaving(false)
            if (isSaved) {
                onOpenChange(false)
            }
        })
    }

    return (
        <FormDialog
            open
            title="文章设置"
            description="正文在批次目录的 Markdown 文件里维护，这里只改发布用的元信息。"
            submitLabel="保存"
            isSubmitting={isSaving}
            isSubmitDisabled={title.isBlank}
            contentClassName="sm:max-w-lg"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-article-meta-title">标题</FieldLabel>
                <Input
                    id="wechat-article-meta-title"
                    value={title.value}
                    maxLength={WECHAT_ARTICLE_TITLE_MAX}
                    placeholder="推送后显示的标题"
                    disabled={isSaving}
                    onChange={(event) => title.setValue(event.target.value)}
                />
                <FieldDescription>
                    {`最多 ${String(WECHAT_ARTICLE_TITLE_MAX)} 字；改标题会同步重命名正文文件，与笔记规则一致。`}
                </FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-meta-author">作者</FieldLabel>
                <Input
                    id="wechat-article-meta-author"
                    value={author.value}
                    maxLength={WECHAT_ARTICLE_AUTHOR_MAX}
                    placeholder="可留空"
                    disabled={isSaving}
                    onChange={(event) => author.setValue(event.target.value)}
                />
                <FieldDescription>
                    {`最多 ${String(WECHAT_ARTICLE_AUTHOR_MAX)} 字；留空表示不填作者，初值取账号设置里的默认作者。`}
                </FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-meta-digest">摘要</FieldLabel>
                <Textarea
                    id="wechat-article-meta-digest"
                    value={digest.value}
                    rows={2}
                    maxLength={WECHAT_ARTICLE_DIGEST_MAX}
                    placeholder="留空时取正文前若干字"
                    disabled={isSaving}
                    onChange={(event) => digest.setValue(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-article-meta-cover">封面图</FieldLabel>
                <div className="flex items-center gap-2">
                    <Input
                        id="wechat-article-meta-cover"
                        value={coverPath}
                        readOnly
                        placeholder="未指定：推送时取正文首图"
                        disabled={isSaving}
                    />
                    <Button variant="outline" disabled={isSaving} onClick={handlePickCover}>
                        选择
                    </Button>
                    {coverPath.length > 0 && (
                        <Button variant="ghost" disabled={isSaving} onClick={() => setCoverPath('')}>
                            清除
                        </Button>
                    )}
                </div>
                <FieldDescription>只支持 jpg / png；留空时取正文第一张本地图片作封面。</FieldDescription>
            </Field>
            <Field>
                <div className="flex items-center gap-2">
                    <Checkbox
                        id="wechat-article-meta-comment"
                        checked={isCommentAllowed}
                        disabled={isSaving}
                        onCheckedChange={(value) => setIsCommentAllowed(value === true)}
                    />
                    <FieldLabel htmlFor="wechat-article-meta-comment">允许读者留言</FieldLabel>
                </div>
                <FieldDescription>需账号已开通留言功能；未开通时平台侧不会生效。</FieldDescription>
            </Field>
        </FormDialog>
    )
}
