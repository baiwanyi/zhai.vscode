/**
 * 留言文案：读者标识、正文摘要、详情时间与页头/筛选说明，集中一份展示口径。
 * 复用约定：时间一律走 @shared/utils/format 的 formatDateTime 与 formatRelativeTime，不自行格式化日期；
 * 读者身份只露 openid 尾号，列表正文交给 CSS 行数截断，本模块只在必须单行的位置裁剪文案。
 * 关键约束：留言正文按纯文本展示、不做 Markdown 渲染，文案层也不拼 HTML——读者输入不能被当作文档解释；
 * 说明文案必须写明筛选「作用于已加载条目」，平台的列表接口没有筛选参数，不能让用户误读成全量统计。
 */
import type { WechatCommentSummary } from '@shared/types/wechat'
import { formatDateTime, formatRelativeTime } from '@shared/utils/format'

/** 单行摘要的裁剪长度：详情标题、删除确认等只放一句话的位置使用 */
const EXCERPT_MAX = 40

/** 读者标识：正文里放完整 openid 既无用也不该随手展示，只露尾号；平台不返回 openid 时标为游客 */
export function readFanLabel(openid?: string): string {
    if (openid === undefined || openid.length === 0) {
        return '游客'
    }
    return openid.length > 6 ? `读者 …${openid.slice(-6)}` : '读者'
}

/** 单行摘要：折叠所有空白后再裁剪，避免换行把摘要撑成多行 */
export function readCommentExcerpt(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim()
    if (normalized.length <= EXCERPT_MAX) {
        return normalized
    }
    return `${normalized.slice(0, EXCERPT_MAX)}…`
}

/** 列表元信息：读者 + 相对时间，条目的首行只放这两个信号 */
export function readCommentMeta(comment: WechatCommentSummary): string {
    const time = formatRelativeTime(comment.createdAt)
    return time.length === 0 ? readFanLabel(comment.openid) : `${readFanLabel(comment.openid)} · ${time}`
}

/** 详情时间：绝对时间为主、相对时间为辅，审计一条留言时两者都要能读到 */
export function readCommentDetailTime(comment: WechatCommentSummary): string {
    const absolute = formatDateTime(comment.createdAt)
    const relative = formatRelativeTime(comment.createdAt)
    if (absolute.length === 0) {
        return relative.length === 0 ? '时间未知' : relative
    }
    return relative.length === 0 ? absolute : `${absolute}（${relative}）`
}

/** 文章上下文：留言挂在某一篇文章下，详情与页头都要能说清是哪一篇 */
export function readArticleLabel(sortIndex: number, title: string): string {
    return `第 ${String(sortIndex)} 篇 · ${title}`
}

/**
 * 页头描述：账号 + 当前文章 + 条数。
 * 关键约束：不再重复「已加载 / 总数」——那是筛选栏右侧的职责，同一行出现两次只会互相干扰。
 */
export function readPageDescription(accountName: string, articleTitle: string | null, total: number): string {
    if (articleTitle === null) {
        return `${accountName} · 无已群发文章`
    }
    const scope = `${accountName} · ${articleTitle}`
    return total === 0 ? `${scope} · 暂无留言` : `${scope} · ${String(total)} 条留言`
}

/** 筛选栏右侧口径说明：明确数字只覆盖已加载的条目 */
export function readFilterCaption(loaded: number, total: number): string {
    if (total === 0) {
        return '暂无留言'
    }
    return loaded >= total ? `共 ${String(total)} 条` : `已加载 ${String(loaded)}/${String(total)} 条`
}
