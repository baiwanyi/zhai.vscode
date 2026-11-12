/**
 * 公众号账号页（#/wechat/{accountId}）：账号名与状态、推送批次列表、批次内文章的增删与导入。
 * 复用约定：外壳取 components/AppPage（页头/页脚由 layout/WechatPostHeader、WechatPostFooter 承担），
 * 数据取 hooks/useWechatAccounts 与 hooks/useWechatIssues，筛选分页取 useWechatIssueQuery，
 * 弹窗编排取 useWechatContentDialogs / useWechatAccountDialogs / useWechatPublishConfirm，
 * 弹窗渲染统一交给 layout/WechatPostDialogs。
 * 关键约束：本页只做数据装配与布局，不承载筛选与弹窗状态，也不拼装展示文案（口径在 wechat/utils）；
 * 本页按 accountId 从账号快照中定位，切换账号由路由外壳重新挂载（key 为 accountId）；
 * 新建批次、添加文章与导入都不弹表单，宿主直接建目录/文件并打开编辑器；
 * 账号不存在（被删除或 hash 手改）与账号读取失败都要给出可执行出口，不渲染空白页。
 */
import { Send } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Spinner } from '@components/ui/spinner'
import type { WechatArticleSummary, WechatIssueSummary } from '@shared/types/wechat'
import { AppContent, AppPage } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useWechatAccountDialogs } from './hooks/useWechatAccountDialogs'
import { useWechatAccounts } from './hooks/useWechatAccounts'
import { useWechatContentDialogs } from './hooks/useWechatContentDialogs'
import { useWechatIssueQuery } from './hooks/useWechatIssueQuery'
import { useWechatIssues } from './hooks/useWechatIssues'
import { useWechatModuleSync } from './hooks/useWechatModuleSync'
import { useWechatPublishConfirm } from './hooks/useWechatPublishConfirm'
import { WechatIssueList } from './layout/WechatIssueList'
import { WechatPostDialogs } from './layout/WechatPostDialogs'
import { WechatPostFooter } from './layout/WechatPostFooter'
import { WechatPostHeader } from './layout/WechatPostHeader'
import { formatAccountMeta, formatAccountStatusHint, readDefaultArticleAuthor, WECHAT_STATUS_LABELS } from './utils'
import type { JSX } from 'react'

interface DashboardWechatPostProps {
    /** 当前账号 id：由路由外壳下发，来自 #/wechat/{accountId} */
    accountId: string
    /** 账号被删除后的出口：由路由外壳下发，回到账号列表 */
    onRemoved: () => void
}

export function DashboardWechatPost({ accountId, onRemoved }: DashboardWechatPostProps): JSX.Element {
    // 直接落到账号页（刷新、深链）时同样需要同步模块，否则侧栏不会出现公众号分区
    useWechatModuleSync()
    const {
        accounts,
        status: accountStatus,
        error: accountError,
        isMutating: isAccountMutating,
        reload: reloadAccounts,
        updateAccount,
        saveCredentials,
        removeAccount,
        testAccount,
    } = useWechatAccounts()
    const {
        issues,
        status: issueStatus,
        error: issueError,
        isMutating: isIssueMutating,
        reload: reloadIssues,
        createIssue,
        removeIssue,
        quickCreateArticle,
        openArticle,
        moveArticle,
        updateArticleMeta,
        readCoverSource,
        saveArticleCover,
        removeArticle,
        importArticle,
        publishDraft,
        publish,
        publishProgress,
        loadQuota,
        openBackend,
    } = useWechatIssues(accountId)

    const account = useMemo(() => accounts.find((item) => item.id === accountId) ?? null, [accountId, accounts])
    const query = useWechatIssueQuery(issues)
    const content = useWechatContentDialogs({ updateArticleMeta, saveArticleCover, removeArticle, removeIssue })
    const accountDialogs = useWechatAccountDialogs({
        accountId,
        onRemoved,
        updateAccount,
        saveCredentials,
        removeAccount,
    })
    const publishConfirm = useWechatPublishConfirm({ accountName: account?.name ?? '', loadQuota, publish })

    /** 作者默认值：账号设置优先，其次是列表里最近一篇填过作者的文章，取值口径在 wechat/utils */
    const defaultArticleAuthor = useMemo(() => readDefaultArticleAuthor(account, issues), [account, issues])

    /** 新建批次：宿主按默认命名直接建好目录，不弹表单 */
    const handleCreateIssue = useCallback((): void => {
        void createIssue()
    }, [createIssue])

    /** 添加文章：宿主直接建 md 文件并打开编辑器，标题与封面等元信息随后在工作流面板设置 */
    const handleAddArticle = useCallback(
        (issue: WechatIssueSummary): void => {
            void quickCreateArticle(issue.id)
        },
        [quickCreateArticle],
    )

    /** 导入即进入二次编辑：源内容已复制成批次副本，直接打开该文件代替弹窗 */
    const handleImportArticle = useCallback(
        async (issue: WechatIssueSummary, sourceKind: 'note' | 'press'): Promise<void> => {
            const detail = await importArticle(issue.id, sourceKind)
            if (detail !== null) {
                await openArticle(detail.id)
            }
        },
        [importArticle, openArticle],
    )

    /** 打开文章：正文在批次文件里维护，点击文章行即打开该文档 */
    const handleOpenArticle = useCallback(
        (article: WechatArticleSummary): void => {
            void openArticle(article.id)
        },
        [openArticle],
    )

    /** 封面地址：只认当前渲染批次的取图结果，缺失项返回 undefined 由弹窗回落占位 */
    const coverUriOf = useCallback(
        (article: WechatArticleSummary): string | undefined =>
            article.coverPath === undefined ? undefined : query.covers[article.coverPath],
        [query.covers],
    )

    if (accountStatus === 'loading') {
        return <StateEmpty title="正在读取账号" isLoading />
    }

    if (accountStatus === 'error') {
        return (
            <StateEmpty title="无法读取账号" description={accountError ?? '请稍后重试'}>
                <Button variant="outline" onClick={() => void reloadAccounts()}>
                    重试
                </Button>
                <Button variant="ghost" onClick={onRemoved}>
                    返回账号列表
                </Button>
            </StateEmpty>
        )
    }

    if (account === null) {
        return (
            <StateEmpty title="找不到该公众号账号" description="账号可能已被删除，或链接里的标识不完整。" icon={Send}>
                <Button variant="outline" onClick={onRemoved}>
                    返回账号列表
                </Button>
            </StateEmpty>
        )
    }

    const statusText =
        account.status === 'connected'
            ? formatAccountMeta(account)
            : `${WECHAT_STATUS_LABELS[account.status]} · ${formatAccountStatusHint(account)}`

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <WechatPostHeader
                    account={account}
                    statusText={statusText}
                    filter={query.filter}
                    sort={query.sort}
                    onFilterChange={query.setFilter}
                    onSortChange={query.setSort}
                />
                <AppContent isScrollable>
                    {/* 推送阶段：宿主分阶段播报，动作结束后由 hook 清空 */}
                    {publishProgress !== null && (
                        <div className="mb-2 flex shrink-0 items-center gap-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                            <Spinner className="size-3" />
                            <span className="truncate">{publishProgress.message}</span>
                        </div>
                    )}
                    <WechatIssueList
                        issues={query.renderIssues}
                        status={issueStatus}
                        error={issueError}
                        isBusy={isIssueMutating}
                        covers={query.covers}
                        isFiltered={query.filter !== 'all'}
                        onClearFilter={() => query.setFilter('all')}
                        onAdd={handleCreateIssue}
                        onRetry={() => void reloadIssues()}
                        onAddArticle={handleAddArticle}
                        onImport={(issue, sourceKind) => void handleImportArticle(issue, sourceKind)}
                        onOpenArticle={handleOpenArticle}
                        onOpenArticleSetting={content.meta.open}
                        onPickCover={content.cover.open}
                        onMoveArticle={(article, direction) => void moveArticle(article.id, direction)}
                        onRemoveArticle={(issue, article) => content.articleRemove.request(article)}
                        onRemoveIssue={content.issueRemove.request}
                        onPublishDraft={(issue) => void publishDraft(issue.id)}
                        onPublish={publishConfirm.request}
                        onOpenBackend={() => void openBackend()}
                    />
                    {query.hasMore && (
                        <Button variant="outline" className="mt-2 w-full" onClick={query.loadMore}>
                            {`加载更多（还有 ${String(query.remaining)} 个）`}
                        </Button>
                    )}
                </AppContent>
                <WechatPostFooter
                    account={account}
                    isBusy={isIssueMutating}
                    isAccountBusy={isAccountMutating}
                    onOpenAccountSettings={accountDialogs.edit.open}
                    onOpenCredentials={accountDialogs.credentials.open}
                    onTestAccount={() => void testAccount(accountId)}
                    onOpenAccountRemove={accountDialogs.remove.open}
                    onCreateIssue={handleCreateIssue}
                />
            </AppPage>

            <WechatPostDialogs
                content={content}
                accountDialogs={accountDialogs}
                publish={publishConfirm}
                account={account}
                defaultAuthor={defaultArticleAuthor}
                isBusy={isIssueMutating}
                isAccountBusy={isAccountMutating}
                coverUriOf={coverUriOf}
                onReadCoverSource={readCoverSource}
            />
        </>
    )
}
