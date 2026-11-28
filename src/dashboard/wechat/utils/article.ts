/**
 * 公众号文章展示口径：来源文案、行元信息与作者默认值。
 * 复用约定：来源文案取 shared/types/wechat 的枚举，作者默认值优先账号设置、其次最近填过作者的文章。
 * 关键约束：作者默认值只作为弹窗初始值，不落库也不参与校验；手写稿不重复标注来源。
 */
import type {
    WechatAccountSummary,
    WechatArticleSourceKind,
    WechatArticleSummary,
    WechatIssueSummary,
} from '@shared/types/wechat'

/** 文章正文来源文案 */
export const WECHAT_ARTICLE_SOURCE_LABELS: Readonly<Record<WechatArticleSourceKind, string>> = {
    manual: '手写',
    note: '笔记',
    press: '作品',
}

/** 文章行元信息：来源 + 字数，手写稿不重复标注来源 */
export function formatArticleMeta(article: WechatArticleSummary): string {
    const source = article.sourceKind === 'manual' ? '' : `来自${WECHAT_ARTICLE_SOURCE_LABELS[article.sourceKind]} · `
    return `${source}${String(article.wordCount)} 字`
}

/**
 * 文章设置弹窗的作者默认值：账号默认作者优先，其次列表里最近一篇填过作者的文章。
 * 关键约束：只作为弹窗初始值，不落库也不参与校验，用户改完即按文章各自保存。
 */
export function readDefaultArticleAuthor(account: WechatAccountSummary | null, issues: WechatIssueSummary[]): string {
    if (account !== null && account.defaultAuthor !== undefined && account.defaultAuthor.length > 0) {
        return account.defaultAuthor
    }
    for (const issue of issues) {
        for (const article of issue.articles) {
            if (article.author !== undefined && article.author.length > 0) {
                return article.author
            }
        }
    }
    return ''
}
