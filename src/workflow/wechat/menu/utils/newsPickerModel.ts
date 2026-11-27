/**
 * 图文选择器视图模型：把批次与封面映射折算成列表项展示所需字段。
 * 复用约定：类型取 shared/types/wechat，封面缺失时由调用方组件回落占位图；
 * 关键约束：只做纯推导，不发请求也不改状态；状态徽标沿用数据源状态，不在本层过滤。
 */
import type { WechatIssueSummary } from '@shared/types/wechat'

export interface NewsPickerItem {
    coverUrl: string | undefined
    title: string
    isPublished: boolean
    articleCount: number
    isSelected: boolean
}

/** 供列表项渲染：封面取首篇的指定路径，选中态由外部 id 比对得到 */
export function toNewsItem(
    issue: WechatIssueSummary,
    covers: Record<string, string>,
    selectedId: string,
): NewsPickerItem {
    const [firstArticle] = issue.articles
    const coverPath = firstArticle?.coverPath
    return {
        coverUrl: coverPath === undefined ? undefined : covers[coverPath],
        title: issue.title,
        isPublished: issue.status === 'published',
        articleCount: issue.articleCount,
        isSelected: selectedId === issue.id,
    }
}
