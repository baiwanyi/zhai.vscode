/**
 * 公众号账号页（#/wechat/{accountId}）：账号名与状态、推送批次列表、批次内文章的增删改与导入。
 * 复用约定：外壳取 components/AppPage（页头走 AppHeader、筛选走 AppMenu、列表走 AppContent、账号级动作走 AppFooter），
 * 账号数据取 hooks/useWechatAccounts，批次与文章取 hooks/useWechatIssues，展示口径取 wechat/utils，
 * 三个弹窗分别复用 WechatIssueCreateDialog、WechatArticleDialog 与公共 ConfirmDialog。
 * 关键约束：本页按 accountId 从账号快照中定位，切换账号由路由外壳重新挂载（key 为 accountId）；
 * 筛选与排序在本页完成，列表组件只渲染结果，避免两处过滤口径；
 * 编辑文章需先按需拉取正文（列表快照不含 body），拉取失败不打开弹窗；
 * 账号不存在（被删除或 hash 手改）时给出回到列表的出口，不渲染空白页。
 */
import { MoreHorizontal, Plus, Send } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { WechatArticleDetail, WechatArticleSummary, WechatIssueSummary } from '@shared/types/wechat'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useWechatAccounts } from './hooks/useWechatAccounts'
import { useWechatIssues } from './hooks/useWechatIssues'
import { WechatAccountDialog } from './layout/WechatAccountDialog'
import { WechatArticleDialog, type WechatArticleDialogInput } from './layout/WechatArticleDialog'
import { WechatIssueCreateDialog } from './layout/WechatIssueCreateDialog'
import { WechatIssueList } from './layout/WechatIssueList'
import { formatAccountMeta, formatAccountStatusHint, WECHAT_STATUS_LABELS } from './utils'
import type { WechatAccountFormInput } from './hooks/useWechatAccounts'
import type { JSX } from 'react'
import { DashboardBackAction } from '../layout/DashboardBackAction'

/** 状态筛选：只暴露最常用的四档，其余状态并入「全部」 */
type IssueFilter = 'all' | 'draft' | 'published' | 'failed'

/** 排序方式：最近更新或推送时间，后者把未推送的排在末尾 */
type IssueSort = 'updated' | 'published'

/** 筛选选项与文案 */
const FILTER_OPTIONS: readonly { value: IssueFilter; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'draft', label: '草稿' },
    { value: 'published', label: '已推送' },
    { value: 'failed', label: '推送失败' },
]

/** 排序选项与文案 */
const SORT_OPTIONS: readonly { value: IssueSort; label: string }[] = [
    { value: 'updated', label: '最近更新' },
    { value: 'published', label: '推送时间' },
]

/** 收窄选择器回传值：非法值回落到默认档，避免把任意字符串当成筛选条件 */
function readFilter(value: string): IssueFilter {
    return FILTER_OPTIONS.some((item) => item.value === value) ? (value as IssueFilter) : 'all'
}

/** 收窄排序回传值 */
function readSort(value: string): IssueSort {
    return value === 'published' ? 'published' : 'updated'
}

interface DashboardWechatPostProps {
    /** 当前账号 id：由路由外壳下发，来自 #/wechat/{accountId} */
    accountId: string
    /** 账号被删除后的出口：由路由外壳下发，回到账号列表 */
    onRemoved: () => void
}

export function DashboardWechatPost({ accountId, onRemoved }: DashboardWechatPostProps): JSX.Element {
    const {
        accounts,
        status: accountStatus,
        isMutating: isAccountMutating,
        updateAccount,
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
        createArticle,
        updateArticle,
        removeArticle,
        importArticle,
        loadArticle,
    } = useWechatIssues(accountId)

    const [filter, setFilter] = useState<IssueFilter>('all')
    const [sort, setSort] = useState<IssueSort>('updated')
    const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false)
    const [issueDialogKey, setIssueDialogKey] = useState(0)
    const [articleTarget, setArticleTarget] = useState<{ issueId: string; article: WechatArticleDetail | null } | null>(
        null,
    )
    const [articleKey, setArticleKey] = useState(0)
    const [pendingIssue, setPendingIssue] = useState<WechatIssueSummary | null>(null)
    const [pendingArticle, setPendingArticle] = useState<{
        issue: WechatIssueSummary
        article: WechatArticleSummary
    } | null>(null)
    const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false)
    const [accountDialogKey, setAccountDialogKey] = useState(0)
    const [isAccountRemoveOpen, setIsAccountRemoveOpen] = useState(false)

    const account = useMemo(() => accounts.find((item) => item.id === accountId) ?? null, [accountId, accounts])

    /** 筛选与排序：先按状态收窄，再按选定字段倒序，未推送的批次在「推送时间」档排末尾 */
    const visibleIssues = useMemo(() => {
        const filtered =
            filter === 'all'
                ? issues
                : issues.filter((issue) => (filter === 'draft' ? issue.status === 'draft' : issue.status === filter))
        return [...filtered].sort((left, right) => {
            if (sort === 'published') {
                const leftTime = left.publishedAt ?? ''
                const rightTime = right.publishedAt ?? ''
                if (leftTime !== rightTime) {
                    return rightTime.localeCompare(leftTime)
                }
            }
            return right.updatedAt.localeCompare(left.updatedAt)
        })
    }, [filter, issues, sort])

    const openIssueDialog = useCallback((): void => {
        setIssueDialogKey((previous) => previous + 1)
        setIsIssueDialogOpen(true)
    }, [])

    const handleCreateIssue = useCallback(
        async (title: string): Promise<boolean> => {
            const created = await createIssue(title)
            if (created !== null) {
                setIsIssueDialogOpen(false)
                return true
            }
            return false
        },
        [createIssue],
    )

    const handleAddArticle = useCallback((issue: WechatIssueSummary): void => {
        setArticleTarget({ issueId: issue.id, article: null })
        setArticleKey((previous) => previous + 1)
    }, [])

    /** 编辑文章：列表快照不含正文，先按需拉取；拉不到就不打开弹窗，避免出现空表单 */
    const handleEditArticle = useCallback(
        (issue: WechatIssueSummary, article: WechatArticleSummary): void => {
            void loadArticle(issue.id, article.id).then((detail) => {
                if (detail === null) {
                    return
                }
                setArticleTarget({ issueId: issue.id, article: detail })
                setArticleKey((previous) => previous + 1)
            })
        },
        [loadArticle],
    )

    const handleArticleSubmit = useCallback(
        async (input: WechatArticleDialogInput): Promise<boolean> => {
            if (articleTarget === null) {
                return false
            }
            const isSaved =
                articleTarget.article === null
                    ? (await createArticle({ issueId: articleTarget.issueId, ...input })) !== null
                    : await updateArticle({
                          id: articleTarget.article.id,
                          issueId: articleTarget.issueId,
                          title: input.title,
                          author: input.author,
                          digest: input.digest,
                          body: input.body,
                      })
            if (isSaved) {
                setArticleTarget(null)
            }
            return isSaved
        },
        [articleTarget, createArticle, updateArticle],
    )

    const handleConfirmIssueRemove = useCallback((): void => {
        if (pendingIssue === null) {
            return
        }
        const target = pendingIssue
        setPendingIssue(null)
        void removeIssue(target.id)
    }, [pendingIssue, removeIssue])

    const handleConfirmArticleRemove = useCallback((): void => {
        if (pendingArticle === null) {
            return
        }
        const target = pendingArticle
        setPendingArticle(null)
        void removeArticle(target.article.id)
    }, [pendingArticle, removeArticle])

    const handleAccountSubmit = useCallback(
        async (input: WechatAccountFormInput): Promise<boolean> => {
            const isSaved = await updateAccount({ ...input, id: accountId })
            if (isSaved) {
                setIsAccountDialogOpen(false)
            }
            return isSaved
        },
        [accountId, updateAccount],
    )

    const openAccountSettings = useCallback((): void => {
        setAccountDialogKey((previous) => previous + 1)
        setIsAccountDialogOpen(true)
    }, [])

    const handleConfirmAccountRemove = useCallback((): void => {
        setIsAccountRemoveOpen(false)
        void removeAccount(accountId).then((isRemoved) => {
            if (isRemoved) {
                onRemoved()
            }
        })
    }, [accountId, onRemoved, removeAccount])

    const handleClearFilter = useCallback((): void => {
        setFilter('all')
    }, [])

    if (accountStatus === 'loading') {
        return (
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>正在读取账号…</AppTitle>
                    <DashboardBackAction kind="back" />
                </AppHeader>
                <AppContent />
            </AppPage>
        )
    }

    if (account === null) {
        return (
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>账号不存在</AppTitle>
                    <DashboardBackAction kind="back" />
                </AppHeader>
                <AppContent>
                    <StateEmpty
                        title="找不到该公众号账号"
                        description="账号可能已被删除，或链接里的标识不完整。"
                        icon={Send}
                    >
                        <Button variant="outline" onClick={onRemoved}>
                            返回账号列表
                        </Button>
                    </StateEmpty>
                </AppContent>
            </AppPage>
        )
    }

    const statusText =
        account.status === 'connected'
            ? formatAccountMeta(account)
            : `${WECHAT_STATUS_LABELS[account.status]} · ${formatAccountStatusHint(account)}`

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle tooltip={account.name}>{account.name}</AppTitle>
                    <DashboardBackAction kind="back" />
                    <AppDescription>{statusText}</AppDescription>
                    <AppMenu>
                        <Select value={filter} onValueChange={(value) => setFilter(readFilter(value))}>
                            <SelectTrigger size="sm" aria-label="状态筛选" className="min-w-28 flex-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {FILTER_OPTIONS.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={sort} onValueChange={(value) => setSort(readSort(value))}>
                            <SelectTrigger size="sm" aria-label="排序方式" className="min-w-28 flex-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SORT_OPTIONS.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </AppMenu>
                </AppHeader>
                <AppContent isScrollable>
                    <WechatIssueList
                        issues={visibleIssues}
                        status={issueStatus}
                        error={issueError}
                        isBusy={isIssueMutating}
                        isFiltered={filter !== 'all'}
                        onClearFilter={handleClearFilter}
                        onAdd={openIssueDialog}
                        onRetry={() => void reloadIssues()}
                        onAddArticle={handleAddArticle}
                        onImport={(issue, sourceKind) => void importArticle(issue.id, sourceKind)}
                        onEditArticle={handleEditArticle}
                        onRemoveArticle={(issue, article) => setPendingArticle({ issue, article })}
                        onRemoveIssue={setPendingIssue}
                    />
                </AppContent>
                <AppFooter className="justify-between">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label="账号操作" tooltip="账号操作">
                                <MoreHorizontal />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuLabel>{account.name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={openAccountSettings}>账号设置</DropdownMenuItem>
                            <DropdownMenuItem onSelect={openAccountSettings}>密钥设置</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                disabled={isAccountMutating || account.status !== 'connected'}
                                onSelect={() => void testAccount(accountId)}
                            >
                                重新验证连接
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => setIsAccountRemoveOpen(true)}>
                                删除账号
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        size="icon"
                        variant="primary"
                        disabled={isIssueMutating}
                        tooltip="新建批次"
                        aria-label="新建批次"
                        onClick={openIssueDialog}
                    >
                        <Plus />
                    </Button>
                </AppFooter>
            </AppPage>

            <WechatIssueCreateDialog
                key={issueDialogKey}
                open={isIssueDialogOpen}
                isSubmitting={isIssueMutating}
                onOpenChange={setIsIssueDialogOpen}
                onSubmit={handleCreateIssue}
            />

            <WechatArticleDialog
                key={articleKey}
                open={articleTarget !== null}
                article={articleTarget?.article ?? null}
                isSubmitting={isIssueMutating}
                onOpenChange={(open) => {
                    if (!open) {
                        setArticleTarget(null)
                    }
                }}
                onSubmit={handleArticleSubmit}
            />

            <WechatAccountDialog
                key={accountDialogKey}
                open={isAccountDialogOpen}
                account={account}
                isSubmitting={isAccountMutating}
                onOpenChange={setIsAccountDialogOpen}
                onSubmit={handleAccountSubmit}
            />

            <ConfirmDialog
                open={pendingIssue !== null}
                title="删除推送批次"
                description={
                    pendingIssue === null
                        ? ''
                        : `将删除「${pendingIssue.title}」及其中的 ${String(pendingIssue.articleCount)} 篇文章，删除后无法恢复。`
                }
                confirmLabel="删除"
                isDestructive
                isSubmitting={isIssueMutating}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingIssue(null)
                    }
                }}
                onConfirm={handleConfirmIssueRemove}
            />

            <ConfirmDialog
                open={pendingArticle !== null}
                title="移出批次"
                description={
                    pendingArticle === null ? '' : `将从批次中移除「${pendingArticle.article.title}」，源文档不受影响。`
                }
                confirmLabel="移出"
                isDestructive
                isSubmitting={isIssueMutating}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingArticle(null)
                    }
                }}
                onConfirm={handleConfirmArticleRemove}
            />

            <ConfirmDialog
                open={isAccountRemoveOpen}
                title="删除公众号账号"
                description={`将删除「${account.name}」的本地配置、已保存密钥与其下的推送批次，公众号后台的内容不受影响。`}
                confirmLabel="删除"
                isDestructive
                isSubmitting={isAccountMutating}
                onOpenChange={setIsAccountRemoveOpen}
                onConfirm={handleConfirmAccountRemove}
            />
        </>
    )
}
