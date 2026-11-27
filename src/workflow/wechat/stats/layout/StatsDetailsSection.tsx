/**
 * 明细分派：有逐项明细用 ItemDetails，否则用 DailyDetails，都为空则不渲染。
 * 链接渲染可注入，缺省只放行微信文章域名。
 */
import type { WechatStatsItem, WechatStatsMetric, WechatStatsQueryResult } from '@shared/types/wechat'
import { DailyDetails } from './DailyDetails'
import { ItemDetails } from './ItemDetails'
import type { JSX, ReactNode } from 'react'
import { readArticleUrl } from '../utils/statsFormat'

/** 明细链接渲染器：返回节点，undefined 表示不显示 */
export type ArticleLinkRenderer = (item: WechatStatsItem) => ReactNode

/** 默认渲染器：白名单通过后新窗口打开原文 */
const DEFAULT_RENDER_ARTICLE_LINK: ArticleLinkRenderer = (item) => {
    const url = readArticleUrl(item.url)
    if (url === undefined) {
        return null
    }
    return (
        <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
            打开原文
        </a>
    )
}

interface StatsDetailsSectionProps {
    result: WechatStatsQueryResult
    metric: WechatStatsMetric
    renderArticleLink?: ArticleLinkRenderer
}

export function StatsDetailsSection({
    result,
    metric,
    renderArticleLink = DEFAULT_RENDER_ARTICLE_LINK,
}: StatsDetailsSectionProps): JSX.Element | null {
    if (result.items.length > 0) {
        return <ItemDetails items={result.items} metricKey={metric.key} renderArticleLink={renderArticleLink} />
    }
    if (result.points.length > 0) {
        return <DailyDetails metric={metric} points={result.points} />
    }
    return null
}
