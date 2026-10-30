/**
 * 推送批次卡片：封面占位、批次标题与状态徽标、文章行列表、批次操作菜单。
 * 复用 @components/ui 的 item 槽位、badge 与 dropdown-menu，批次与文章的展示口径取 wechat/utils。
 * 关键约束：一次群发即一个批次，因此「推送」是批次级动作而不是文章级，本卡片不提供单篇推送；
 * 文章行点击进入编辑，行内菜单负责「移出批次」；批次菜单的「推送」在当前阶段保持禁用并说明原因；
 * 文章数达到上限时，菜单里的添加与导入同时禁用，避免用户点了才被宿主拒绝。
 */
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import { WECHAT_ISSUE_ARTICLE_LIMIT, type WechatArticleSummary, type WechatIssueSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { formatArticleMeta, formatIssueMeta, WECHAT_ISSUE_STATUS_LABELS, WECHAT_ISSUE_STATUS_VARIANTS } from '../utils'

interface WechatIssueCardProps {
    issue: WechatIssueSummary
    /** 写操作进行中：菜单项整体禁用，避免并发写导致序号错乱 */
    isBusy: boolean
    onAddArticle: (issue: WechatIssueSummary) => void
    onImport: (issue: WechatIssueSummary, sourceKind: 'note' | 'press') => void
    onEditArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
    onRemoveArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
    onRemoveIssue: (issue: WechatIssueSummary) => void
    onPublishDraft: (issue: WechatIssueSummary) => void
    /** 打开公众号后台：草稿生成后去后台预览或群发 */
    onOpenBackend: () => void
}

export function WechatIssueCard({
    issue,
    isBusy,
    onAddArticle,
    onImport,
    onEditArticle,
    onRemoveArticle,
    onRemoveIssue,
    onPublishDraft,
    onOpenBackend,
}: WechatIssueCardProps): JSX.Element {
    const isFull = issue.articleCount >= WECHAT_ISSUE_ARTICLE_LIMIT

    return (
        <Item variant="outline" className="flex-col items-stretch gap-2 p-3">
            <div className="flex items-start gap-2">
                <ItemContent className="min-w-0">
                    <ItemTitle className="w-full">
                        <span className="block min-w-0 flex-1 truncate">{issue.title}</span>
                    </ItemTitle>
                    <ItemDescription className="truncate text-xs">{formatIssueMeta(issue)}</ItemDescription>
                </ItemContent>
                <ItemActions className="shrink-0 gap-1">
                    <Badge variant={WECHAT_ISSUE_STATUS_VARIANTS[issue.status]}>
                        {WECHAT_ISSUE_STATUS_LABELS[issue.status]}
                    </Badge>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`${issue.title} 的操作`}
                                tooltip="批次操作"
                                disabled={isBusy}
                            >
                                <MoreHorizontal />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={isBusy || isFull} onSelect={() => onAddArticle(issue)}>
                                添加文章
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={isBusy || isFull} onSelect={() => onImport(issue, 'note')}>
                                从笔记导入
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={isBusy || isFull} onSelect={() => onImport(issue, 'press')}>
                                从作品导入
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                disabled={isBusy || issue.articleCount === 0}
                                onSelect={() => onPublishDraft(issue)}
                            >
                                {issue.status === 'ready' ? '更新草稿' : '生成草稿'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={issue.status !== 'ready' && issue.status !== 'published'}
                                onSelect={onOpenBackend}
                            >
                                打开公众号后台
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant="destructive"
                                disabled={isBusy}
                                onSelect={() => onRemoveIssue(issue)}
                            >
                                删除批次
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </ItemActions>
            </div>

            {issue.articles.length === 0 ? (
                <p className="rounded-lg border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
                    批次还没有文章，可从笔记、作品导入或手写一篇。
                </p>
            ) : (
                <ul className="flex flex-col">
                    {issue.articles.map((article) => (
                        <li key={article.id} className="flex items-center gap-1">
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-muted"
                                onClick={() => onEditArticle(issue, article)}
                            >
                                <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">
                                    {article.sortIndex}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">{article.title}</span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {formatArticleMeta(article)}
                                    </span>
                                </span>
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            </button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`${article.title} 的操作`}
                                        tooltip="文章操作"
                                        disabled={isBusy}
                                    >
                                        <MoreHorizontal />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => onEditArticle(issue, article)}>
                                        编辑
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => onRemoveArticle(issue, article)}
                                    >
                                        移出批次
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </li>
                    ))}
                </ul>
            )}

            {issue.errorHint !== undefined && issue.errorHint.length > 0 && (
                <p className="text-xs text-destructive">{issue.errorHint}</p>
            )}
        </Item>
    )
}
