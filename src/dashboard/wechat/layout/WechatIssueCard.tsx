/**
 * 推送批次卡片：状态徽标、批次操作菜单，以及批次内按篇数分档的文章区。
 * 复用 @components/ui 的 item 槽位、badge 与 dropdown-menu，批次与文章的展示口径取 wechat/utils，
 * 封面图复用 components/Image（缺失或加载失败自带占位）。
 * 关键约束：批次标题不在卡片上展示（新建即默认命名，用户靠封面与文章辨认），只作为无障碍标签保留；
 * 一次群发即一个批次，因此「推送」是批次级动作而不是文章级，本卡片不提供单篇推送；
 * 文章区固定以第一篇为主图（2.35:1），第 2 篇起进子列表（1:1 缩略图），两处都不显示序号；
 * 文章行点击直接打开批次目录里的 md 文件，正文只在编辑器里维护；
 * 标题、封面、摘要与留言开关在工作流面板的推送分区逐篇设置，卡片只展示结果并负责调序与删除；
 * 删除会连同批次目录里的 md 一起删掉（宿主优先移入回收站），第一篇删掉后其余文章按序号顺延顶上；
 * 文章数达到上限时，菜单里的添加与导入同时禁用，避免用户点了才被宿主拒绝。
 */
import { MoreHorizontal } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemHeader,
    ItemMedia,
    ItemTitle,
} from '@components/ui/item'
import { WECHAT_ISSUE_ARTICLE_LIMIT, type WechatArticleSummary, type WechatIssueSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { JSX } from 'react'
import { formatArticleMeta, formatIssueMeta, WECHAT_ISSUE_STATUS_LABELS, WECHAT_ISSUE_STATUS_VARIANTS } from '../utils'

/** 文章调整方向：顺序号即推送顺序 */
type ArticleDirection = 'up' | 'down'

interface WechatIssueCardProps {
    issue: WechatIssueSummary
    /** 文章封面在 Webview 里的地址：键为文章里的 coverPath，缺失时该篇显示占位图 */
    covers: Record<string, string>
    /** 写操作进行中：菜单项整体禁用，避免并发写导致序号错乱 */
    isBusy: boolean
    onAddArticle: (issue: WechatIssueSummary) => void
    onImport: (issue: WechatIssueSummary, sourceKind: 'note' | 'press') => void
    /** 打开正文文件：卡片不再承载正文编辑 */
    onOpenArticle: (article: WechatArticleSummary) => void
    /** 文章设置：作者、摘要与留言开关，走 wechat/article/meta */
    onOpenArticleSetting: (article: WechatArticleSummary) => void
    /** 上移 / 下移一篇：顺序号即公众号的推送顺序 */
    onMoveArticle: (article: WechatArticleSummary, direction: ArticleDirection) => void
    onRemoveArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
    onRemoveIssue: (issue: WechatIssueSummary) => void
    onPublishDraft: (issue: WechatIssueSummary) => void
    /** 正式群发：需已有草稿，确认弹窗由页面承担 */
    onPublish: (issue: WechatIssueSummary) => void
    /** 打开公众号后台：草稿生成后去后台预览或群发 */
    onOpenBackend: () => void
}

export function WechatIssueCard({
    issue,
    covers,
    isBusy,
    onAddArticle,
    onImport,
    onOpenArticle,
    onOpenArticleSetting,
    onMoveArticle,
    onRemoveArticle,
    onRemoveIssue,
    onPublishDraft,
    onPublish,
    onOpenBackend,
}: WechatIssueCardProps): JSX.Element {
    const isFull = issue.articleCount >= WECHAT_ISSUE_ARTICLE_LIMIT
    /** 群发只在草稿就绪或上次失败后可点：没有 media_id 时宿主会拒绝，前端先置灰避免无效点击 */
    const canPublish = issue.status === 'ready' || issue.status === 'failed'
    const [firstArticle] = issue.articles
    const restArticles = issue.articles.slice(1)
    /** 取某篇文章的封面地址：封面路径缺失或转换失败时交给 Image 渲染占位 */
    const coverOf = (article: WechatArticleSummary): string | undefined => {
        const coverPath = article.coverPath
        return coverPath === undefined ? undefined : covers[coverPath]
    }

    return (
        <Item variant="outline" className="flex-col items-stretch gap-2 p-3">
            <ItemHeader>
                <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={WECHAT_ISSUE_STATUS_VARIANTS[issue.status]}>
                        {WECHAT_ISSUE_STATUS_LABELS[issue.status]}
                    </Badge>
                    <div className="min-w-0 truncate text-xs">{formatIssueMeta(issue)}</div>
                </div>
                <ItemActions className="shrink-0 gap-1">
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
                            <DropdownMenuItem disabled={isBusy || !canPublish} onSelect={() => onPublish(issue)}>
                                群发
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
            </ItemHeader>

            {firstArticle === undefined ? (
                <p className="rounded-lg border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
                    批次还没有文章：添加文章会直接新建 md 文档，也可以从笔记或作品导入。
                </p>
            ) : (
                <ArticleFeature
                    issue={issue}
                    article={firstArticle}
                    coverUri={coverOf(firstArticle)}
                    isBusy={isBusy}
                    onOpenArticle={onOpenArticle}
                    onOpenArticleSetting={onOpenArticleSetting}
                    onMoveArticle={onMoveArticle}
                    onRemoveArticle={onRemoveArticle}
                />
            )}

            {restArticles.length > 0 && (
                <ItemGroup>
                    {restArticles.map((article, index) => (
                        <Item key={article.id} variant="muted">
                            <ItemMedia variant="image">
                                <Image src={coverOf(article)} alt={article.title} aspect="square" />
                            </ItemMedia>
                            <ItemContent className="min-w-0">
                                <ItemTitle className="w-full">
                                    <button
                                        type="button"
                                        className="block min-w-0 flex-1 truncate text-left"
                                        onClick={() => onOpenArticle(article)}
                                    >
                                        {article.title}
                                    </button>
                                </ItemTitle>
                                <ItemDescription className="truncate text-xs">
                                    {formatArticleMeta(article)}
                                </ItemDescription>
                            </ItemContent>
                            <ItemActions className="shrink-0 gap-1">
                                <ArticleMenu
                                    issue={issue}
                                    article={article}
                                    isFirst={false}
                                    isLast={index === restArticles.length - 1}
                                    isBusy={isBusy}
                                    onOpenArticle={onOpenArticle}
                                    onOpenArticleSetting={onOpenArticleSetting}
                                    onMoveArticle={onMoveArticle}
                                    onRemoveArticle={onRemoveArticle}
                                />
                            </ItemActions>
                        </Item>
                    ))}
                </ItemGroup>
            )}

            {issue.errorHint !== undefined && issue.errorHint.length > 0 && (
                <p className="text-xs text-destructive">{issue.errorHint}</p>
            )}
        </Item>
    )
}

interface ArticleFeatureProps {
    issue: WechatIssueSummary
    article: WechatArticleSummary
    coverUri?: string
    isBusy: boolean
    onOpenArticle: (article: WechatArticleSummary) => void
    onOpenArticleSetting: (article: WechatArticleSummary) => void
    onMoveArticle: (article: WechatArticleSummary, direction: ArticleDirection) => void
    onRemoveArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
}

/** 第一篇：主图位，封面按公众号首图习惯取 2.35:1，可下移但不能再上移 */
function ArticleFeature({
    issue,
    article,
    coverUri,
    isBusy,
    onOpenArticle,
    onOpenArticleSetting,
    onMoveArticle,
    onRemoveArticle,
}: ArticleFeatureProps): JSX.Element {
    return (
        <Item variant="muted" className="gap-2">
            <Image
                src={coverUri}
                alt={article.title}
                aspect="2.35/1"
                className="h-auto w-full rounded-lg bg-muted/40"
            />
            <ItemContent className="min-w-0">
                <ItemTitle className="w-full">
                    <button
                        type="button"
                        className="block min-w-0 flex-1 truncate text-left"
                        onClick={() => onOpenArticle(article)}
                    >
                        {article.title}
                    </button>
                </ItemTitle>
                <ItemDescription className="truncate text-xs">{formatArticleMeta(article)}</ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0 gap-1">
                <ArticleMenu
                    issue={issue}
                    article={article}
                    isFirst
                    isLast={issue.articles.length === 1}
                    isBusy={isBusy}
                    onOpenArticle={onOpenArticle}
                    onOpenArticleSetting={onOpenArticleSetting}
                    onMoveArticle={onMoveArticle}
                    onRemoveArticle={onRemoveArticle}
                />
            </ItemActions>
        </Item>
    )
}

interface ArticleMenuProps {
    issue: WechatIssueSummary
    article: WechatArticleSummary
    /** 第一篇不能再上移，最后一条不能再下移 */
    isFirst: boolean
    isLast: boolean
    isBusy: boolean
    onOpenArticle: (article: WechatArticleSummary) => void
    onOpenArticleSetting: (article: WechatArticleSummary) => void
    onMoveArticle: (article: WechatArticleSummary, direction: ArticleDirection) => void
    onRemoveArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
}

/** 文章行内菜单：打开、设置、调序与删除统一在此，越界方向直接置灰 */
function ArticleMenu({
    issue,
    article,
    isFirst,
    isLast,
    isBusy,
    onOpenArticle,
    onOpenArticleSetting,
    onMoveArticle,
    onRemoveArticle,
}: ArticleMenuProps): JSX.Element {
    return (
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
                <DropdownMenuItem onSelect={() => onOpenArticle(article)}>打开文档</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenArticleSetting(article)}>文章设置</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={isBusy || isFirst} onSelect={() => onMoveArticle(article, 'up')}>
                    上移
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isBusy || isLast} onSelect={() => onMoveArticle(article, 'down')}>
                    下移
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onRemoveArticle(issue, article)}>
                    删除
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
