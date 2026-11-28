/**
 * 文章行内菜单：打开、设置、调序与删除统一在此，越界方向直接置灰。
 * 复用约定：下拉取 @components/ui/dropdown-menu，图标取 lucide，触发按钮取 components/Button；
 * 调序方向取 constants 的共享类型，与首篇主图组件及批次卡片口径一致。
 * 关键约束：首篇不能再上移、末篇不能再下移；写操作进行中菜单整体禁用，避免并发写导致序号错乱。
 */
import { MoreHorizontal } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { WechatArticleSummary, WechatIssueSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import type { ArticleDirection } from '../constants'
import type { JSX } from 'react'

interface WechatIssueArticleMenuProps {
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

export function WechatIssueArticleMenu({
    issue,
    article,
    isFirst,
    isLast,
    isBusy,
    onOpenArticle,
    onOpenArticleSetting,
    onMoveArticle,
    onRemoveArticle,
}: WechatIssueArticleMenuProps): JSX.Element {
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
