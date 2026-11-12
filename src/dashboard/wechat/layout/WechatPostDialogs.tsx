/**
 * 账号页的弹窗组：文章设置、封面裁剪、账号设置、密钥设置、三类删除确认与群发确认。
 * 复用约定：目标状态与提交动作全部由 hooks（useWechatContentDialogs / useWechatAccountDialogs /
 * useWechatPublishConfirm）提供，本组件只做渲染与「关闭即清空目标」的适配（closeWhenHidden）。
 * 关键约束：不在此处发请求、不持有状态，弹窗开合完全受控于父层；
 * 关闭适配必须走 closeWhenHidden——直接把 open 布尔接到 setter 上会让打开动作清掉目标。
 */
import type { WechatAccountSummary, WechatArticleSummary } from '@shared/types/wechat'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { WechatAccountDialog } from './WechatAccountDialog'
import { WechatAccountSecretDialog } from './WechatAccountSecretDialog'
import { WechatArticleMetaDialog } from './WechatArticleMetaDialog'
import { WechatCoverDialog } from './WechatCoverDialog'
import type { WechatAccountDialogsState } from '../hooks/useWechatAccountDialogs'
import type { WechatContentDialogsState } from '../hooks/useWechatContentDialogs'
import type { WechatPublishConfirmState } from '../hooks/useWechatPublishConfirm'
import type { JSX } from 'react'
import { closeWhenHidden } from '../utils'

interface WechatPostDialogsProps {
    content: WechatContentDialogsState
    accountDialogs: WechatAccountDialogsState
    publish: WechatPublishConfirmState
    account: WechatAccountSummary
    defaultAuthor: string
    /** 批次写操作进行中：禁用各弹窗的提交 */
    isBusy: boolean
    /** 账号写操作进行中 */
    isAccountBusy: boolean
    coverUriOf: (article: WechatArticleSummary) => string | undefined
    onReadCoverSource: (path: string) => Promise<string | null>
}

export function WechatPostDialogs({
    content,
    accountDialogs,
    publish,
    account,
    defaultAuthor,
    isBusy,
    isAccountBusy,
    coverUriOf,
    onReadCoverSource,
}: WechatPostDialogsProps): JSX.Element {
    const { meta, cover, articleRemove, issueRemove } = content

    return (
        <>
            {meta.target !== null && (
                <WechatArticleMetaDialog
                    key={meta.target.id}
                    article={meta.target}
                    defaultAuthor={defaultAuthor}
                    isSubmitting={isBusy}
                    onOpenChange={closeWhenHidden(meta.close)}
                    onSubmit={meta.submit}
                />
            )}

            {cover.target !== null && (
                <WechatCoverDialog
                    key={cover.target.id}
                    article={cover.target}
                    coverUri={coverUriOf(cover.target)}
                    isSubmitting={isBusy}
                    onOpenChange={closeWhenHidden(cover.close)}
                    onReadImage={onReadCoverSource}
                    onSubmit={cover.submit}
                />
            )}

            <WechatAccountDialog
                key={accountDialogs.edit.key}
                open={accountDialogs.edit.isOpen}
                account={account}
                isSubmitting={isAccountBusy}
                onOpenChange={accountDialogs.edit.setOpen}
                onSubmit={accountDialogs.edit.submit}
            />

            <WechatAccountSecretDialog
                key={accountDialogs.credentials.key}
                open={accountDialogs.credentials.isOpen}
                account={account}
                isSubmitting={isAccountBusy}
                onOpenChange={accountDialogs.credentials.setOpen}
                onSubmit={accountDialogs.credentials.submit}
            />

            <ConfirmDialog
                open={issueRemove.target !== null}
                title="删除推送批次"
                description={
                    issueRemove.target === null
                        ? ''
                        : `将删除「${issueRemove.target.title}」及其中的 ${String(issueRemove.target.articleCount)} 篇文章，删除后无法恢复。`
                }
                confirmLabel="删除"
                isDestructive
                isSubmitting={isBusy}
                onOpenChange={closeWhenHidden(issueRemove.close)}
                onConfirm={issueRemove.confirm}
            />

            <ConfirmDialog
                open={articleRemove.target !== null}
                title="删除文章"
                description={
                    articleRemove.target === null
                        ? ''
                        : `将删除「${articleRemove.target.title}」及其批次目录内的 Markdown 文档（优先移入系统回收站，回收站不可用时永久删除），删除后其余文章自动顺延序号。`
                }
                confirmLabel="删除"
                isDestructive
                isSubmitting={isBusy}
                onOpenChange={closeWhenHidden(articleRemove.close)}
                onConfirm={articleRemove.confirm}
            />

            <ConfirmDialog
                open={publish.target !== null}
                title="确认群发"
                description={publish.description}
                confirmLabel="群发"
                isSubmitting={isBusy}
                onOpenChange={closeWhenHidden(publish.close)}
                onConfirm={publish.confirm}
            />

            <ConfirmDialog
                open={accountDialogs.remove.isOpen}
                title="删除公众号账号"
                description={`将删除「${account.name}」的本地配置、已保存密钥与其下的推送批次，公众号后台的内容不受影响。`}
                confirmLabel="删除"
                isDestructive
                isSubmitting={isAccountBusy}
                onOpenChange={accountDialogs.remove.setOpen}
                onConfirm={accountDialogs.remove.confirm}
            />
        </>
    )
}
