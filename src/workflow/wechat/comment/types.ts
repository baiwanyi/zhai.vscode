/**
 * 留言管理本地交互类型：筛选维度、回复草稿与交互动作，只服务工作流侧栏，不进协议层。
 * 复用约定：留言实体沿用 @shared/types/wechat 的 WechatCommentSummary，本文件不重复声明数据字段；
 * 动作对象由交互 Hook 统一实现，列表、条目、详情与确认弹窗只按类型消费自己需要的部分。
 * 关键约束：筛选只作用于已加载条目——平台列表接口没有筛选参数，维度值不得与协议参数混用；
 * 关闭详情与关闭确认是两个动作，不能合并成一个 onOpenChange，否则两层浮层会互相收起。
 */

import type { WechatCommentSummary } from '@shared/types/wechat'

/** 筛选维度：全部 / 已设精选 / 作者尚未回复 */
export type CommentFilter = 'all' | 'elected' | 'unreplied'

/** 回复草稿：commentId 决定草稿归属哪条留言，切换留言时必须整体替换而不是只改 content */
export interface CommentReplyDraft {
    commentId: number
    content: string
}

/** 留言页交互动作：页面收拢一份后下发给各布局组件，避免逐条透传回调 */
export interface WechatCommentActions {
    onChangeFilter: (filter: CommentFilter) => void
    onSelectIssue: (issueId: string) => void
    onSelectArticle: (sortIndex: number) => void
    onReload: () => void
    onLoadMore: () => void
    onOpenDetail: (comment: WechatCommentSummary) => void
    onCloseDetail: () => void
    onReply: (comment: WechatCommentSummary) => void
    onReplyChange: (value: string) => void
    onReplySubmit: () => void
    onReplyCancel: () => void
    onToggleElected: (comment: WechatCommentSummary) => void
    onRequestRemove: (comment: WechatCommentSummary) => void
    onCloseRemove: () => void
    onConfirmRemove: () => void
    onOpenArticle: () => void
}
