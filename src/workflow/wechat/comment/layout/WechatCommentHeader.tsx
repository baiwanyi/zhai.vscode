/**
 * 留言页头：数据源（批次 / 文章）选择、刷新入口与条数说明。
 * 复用约定：外壳取 AppPage 的 Header 族组件，两个下拉统一走 components/OptionSelect，
 * 刷新用 components/Button 的 tooltip 与 aria-label，图标取 lucide。
 * 关键约束：只有已推送且有文章的批次会被父层传入——草稿态没有群发消息标识，列出来只会拿到宿主拒绝；
 * 批次为空时整行下拉不渲染，不给出无法使用的控件；切换批次与文章时由父层同步清空详情与回复草稿。
 */
import { RefreshCw } from 'lucide-react'
import type { WechatIssueSummary } from '@shared/types/wechat'
import { AppAction, AppDescription, AppHeader, AppMenu, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { WechatCommentActions } from '../types'
import type { JSX } from 'react'

interface WechatCommentHeaderProps {
    /** 页头说明：账号与条数口径由 utils/commentText 统一生成 */
    description: string
    /** 可选批次：父层已过滤为「已推送且有文章」 */
    issues: WechatIssueSummary[]
    selectedIssueId: string | null
    selectedSortIndex: number
    actions: WechatCommentActions
}

export function WechatCommentHeader({
    description,
    issues,
    selectedIssueId,
    selectedSortIndex,
    actions,
}: WechatCommentHeaderProps): JSX.Element {
    const issueOptions = issues.map((issue) => ({ value: issue.id, label: issue.title }))
    const selectedIssue = issues.find((issue) => issue.id === selectedIssueId)
    const articleOptions = (selectedIssue?.articles ?? []).map((article) => ({
        value: String(article.sortIndex),
        label: `${String(article.sortIndex)}. ${article.title}`,
    }))

    return (
        <AppHeader>
            <AppTitle>留言管理</AppTitle>
            <AppAction>
                <Button variant="ghost" size="icon" aria-label="刷新" tooltip="刷新" onClick={actions.onReload}>
                    <RefreshCw className="size-3.5" />
                </Button>
            </AppAction>
            {/* 文章标题可能很长：单行截断，完整文案放原生 title，避免页头高度随标题抖动 */}
            <AppDescription className="truncate" title={description}>
                {description}
            </AppDescription>
            {issues.length === 0 ? null : (
                <AppMenu>
                    <OptionSelect
                        value={selectedIssueId ?? ''}
                        options={issueOptions}
                        onChange={actions.onSelectIssue}
                        label="批次"
                        size="sm"
                        className="min-w-0 flex-1"
                    />
                    <OptionSelect
                        value={String(selectedSortIndex)}
                        options={articleOptions}
                        onChange={(value) => actions.onSelectArticle(Number.parseInt(value, 10))}
                        label="文章"
                        size="sm"
                        className="min-w-0 flex-1"
                    />
                </AppMenu>
            )}
        </AppHeader>
    )
}
