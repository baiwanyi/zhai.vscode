/**
 * 微博站内链接：把账号 uid 转成个人主页地址，交给宿主 weibo/openPost 打开。
 * 复用约定：只拼地址、不发起请求，打开动作由 hooks/useWeiboOpenUrl 统一完成；
 * 正文纯文本里的 @账号、话题与链接切分在 @shared/utils/weiboText，本文件只保留主页地址；
 * 目标站 weibo.com 在宿主白名单内，与 weiboHotLinks 的搜索页地址同属一类。
 * 关键约束：uid 来自上游 JSON，可能含 # ? / 等字符，路径段必须 encodeURIComponent，
 * 否则会被当作片段或查询串，打开到错误页面。
 */

/** 个人主页基址：末段为账号 uid */
const PROFILE_URL_BASE = 'https://weibo.com/u'

/** 个人主页地址：uid 转义后拼到固定基址上 */
export function buildProfileUrl(uid: string): string {
    return `${PROFILE_URL_BASE}/${encodeURIComponent(uid)}`
}
