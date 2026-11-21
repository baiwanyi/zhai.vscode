/**
 * 作者名兜底：上游偶尔不给昵称，列表统一显示「匿名」而不是空白。
 * 复用约定：评论、子评论与转发列表共用，避免各写一遍三元判断。
 * 关键约束：只判空串、不 trim——昵称里的空白是上游原样，前端不改写展示。
 */
export function readWeiboAuthorName(name: string): string {
    return name.length > 0 ? name : '匿名'
}
