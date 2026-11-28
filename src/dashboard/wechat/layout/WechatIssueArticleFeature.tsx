/**
 * 批次首篇卡片：2.35:1 主图位与文章标题、元信息及行内菜单，封面点击即换图与裁剪。
 * 复用约定：槽位取 @components/ui 的 item，封面取 components/Image，文案口径取 wechat/utils；
 * 菜单取 layout/WechatIssueArticleMenu，调序方向取 constants 的共享类型。
 * 关键约束：首篇不能再上移，仅批次只有一篇时才是最后一篇；写操作进行中封面与菜单均禁用。
 */
import {
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemTitle,
} from '@components/ui/item'
import type { WechatArticleSummary, WechatIssueSummary } from '@shared/types/wechat'
import { Image } from '@webview/components/Image'
import { WechatIssueArticleMenu } from './WechatIssueArticleMenu'
import type { ArticleDirection } from '../constants'
import type { JSX } from 'react'
import { formatArticleMeta } from '../utils'

interface WechatIssueArticleFeatureProps {
    issue: WechatIssueSummary
    article: WechatArticleSummary
    coverUri?: string
    isBusy: boolean
    onOpenArticle: (article: WechatArticleSummary) => void
    onOpenArticleSetting: (article: WechatArticleSummary) => void
    onPickCover: (article: WechatArticleSummary) => void
    onMoveArticle: (article: WechatArticleSummary, direction: ArticleDirection) => void
    onRemoveArticle: (issue: WechatIssueSummary, article: WechatArticleSummary) => void
}

export function WechatIssueArticleFeature({
    issue,
    article,
    coverUri,
    isBusy,
    onOpenArticle,
    onOpenArticleSetting,
    onPickCover,
    onMoveArticle,
    onRemoveArticle,
}: WechatIssueArticleFeatureProps): JSX.Element {
    return (
        <Item variant="muted" className="gap-2">
            <button
                type="button"
                className="block w-full cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed"
                aria-label={`设置《${article.title}》的封面`}
                title="点击更换封面"
                disabled={isBusy}
                onClick={() => onPickCover(article)}
            >
                <Image
                    src={coverUri}
                    alt={article.title}
                    aspect="2.35/1"
                    className="h-auto w-full rounded-lg bg-muted/40"
                />
            </button>
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
                <WechatIssueArticleMenu
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
