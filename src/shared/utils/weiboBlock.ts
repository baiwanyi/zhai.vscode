/**
 * 微博屏蔽名单：多行文本与名单数组互转，并按用户名与关键字判定单条微博是否隐藏。
 * 复用约定：解析与判定都是纯函数，宿主保存前归一化、Webview 取数后过滤共用同一份口径；
 * 名单项与匹配目标都去掉首尾空白并忽略英文大小写，避免同一个博主换种写法就漏拦。
 * 关键约束：用户名按整串精确匹配（不做模糊包含），关键字按正文包含匹配；
 * 关键字同时检查转发正文，被隐藏的只是这一条微博，不连带隐藏转发者本人的其它内容；
 * 条数与单条长度都按 @shared/types/weibo 的上限收敛，超长项截断而不是整份拒绝。
 */
import {
    WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH,
    WEIBO_BLOCK_LIST_MAX_ITEMS,
    type WeiboBlockRules,
    type WeiboTimelinePost,
} from '@shared/types/weibo'

/** 空规则：没有注入名单时复用同一份引用，避免每轮渲染新建数组破坏下游 memo */
export const EMPTY_WEIBO_BLOCK_RULES: WeiboBlockRules = { blockedUsers: [], blockedKeywords: [] }

/** 名单为空的判定：两个名单都空时过滤是恒等操作，调用方可据此跳过整轮遍历 */
export function isWeiboBlockRulesEmpty(rules: WeiboBlockRules): boolean {
    return rules.blockedUsers.length === 0 && rules.blockedKeywords.length === 0
}

/**
 * 归一化名单：去首尾空白、丢弃空项与重复项（忽略英文大小写，保留首次出现的写法）、
 * 截断超长项，并在达到条数上限后停止收集。
 */
export function normalizeWeiboBlockList(items: readonly string[]): string[] {
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const item of items) {
        const trimmed = item.trim().slice(0, WEIBO_BLOCK_LIST_ITEM_MAX_LENGTH)
        if (trimmed.length === 0) {
            continue
        }
        const key = trimmed.toLowerCase()
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        normalized.push(trimmed)
        if (normalized.length >= WEIBO_BLOCK_LIST_MAX_ITEMS) {
            break
        }
    }
    return normalized
}

/** 多行文本解析成名单：一行一项，空行与重复项丢弃，口径与保存时一致 */
export function parseWeiboBlockListText(text: string): string[] {
    return normalizeWeiboBlockList(text.split(/\r?\n/u))
}

/** 名单还原成多行文本：设置弹窗打开时用它初始化输入框 */
export function formatWeiboBlockListText(items: readonly string[]): string {
    return items.join('\n')
}

/**
 * 追加一个屏蔽用户名：已在名单里（忽略大小写）时原样返回，
 * 调用方据此判断规则是否真的变化，避免一次无效写盘。
 */
export function addWeiboBlockedUser(rules: WeiboBlockRules, name: string): WeiboBlockRules {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
        return rules
    }
    const key = trimmed.toLowerCase()
    if (rules.blockedUsers.some((user) => user.trim().toLowerCase() === key)) {
        return rules
    }
    return { ...rules, blockedUsers: normalizeWeiboBlockList([...rules.blockedUsers, trimmed]) }
}

/** 单条微博是否命中屏蔽规则：作者名精确命中，或正文（含转发正文）包含任一关键字 */
export function isWeiboPostBlocked(post: WeiboTimelinePost, rules: WeiboBlockRules): boolean {
    if (isWeiboBlockRulesEmpty(rules)) {
        return false
    }
    const authorName = post.author.name.trim().toLowerCase()
    if (authorName.length > 0 && rules.blockedUsers.some((user) => user.trim().toLowerCase() === authorName)) {
        return true
    }
    if (rules.blockedKeywords.length === 0) {
        return false
    }
    const text = post.retweeted === null ? post.text : `${post.text}\n${post.retweeted.text}`
    const haystack = text.toLowerCase()
    return rules.blockedKeywords.some((keyword) => haystack.includes(keyword.trim().toLowerCase()))
}

/** 过滤信息流：规则为空时原样返回入参，保证调用方的 memo 不因空过滤而失效 */
export function filterWeiboPosts(posts: WeiboTimelinePost[], rules: WeiboBlockRules): WeiboTimelinePost[] {
    if (isWeiboBlockRulesEmpty(rules)) {
        return posts
    }
    return posts.filter((post) => !isWeiboPostBlocked(post, rules))
}
