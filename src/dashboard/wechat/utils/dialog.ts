/**
 * 公众号弹窗文案与关闭适配：群发确认描述与 onOpenChange 的关闭回调。
 * 复用约定：只消费批次摘要，不重复定义账号与文章的展示口径。
 * 关键约束：群发描述必须带不可撤销提醒；关闭适配只在关闭时回调，打开动作不得清掉弹窗目标。
 */
import type { WechatIssueSummary } from '@shared/types/wechat'

/** 群发确认文案：账号、文章清单、额度说明与不可撤销提醒合成一段 */
export function buildPublishDescription(accountName: string, issue: WechatIssueSummary, quotaReason: string): string {
    const titles = issue.articles.map((item) => item.title).join('、')
    const quotaLine = quotaReason.length > 0 ? `${quotaReason}。` : ''
    return `账号「${accountName}」将群发 ${String(issue.articleCount)} 篇文章：${titles}。${quotaLine}群发后不可撤销，请确认封面与正文已检查。`
}

/** 弹窗 onOpenChange 适配：只在关闭时清空目标，避免打开瞬间把目标清掉 */
export function closeWhenHidden(close: () => void): (open: boolean) => void {
    return (open) => {
        if (!open) {
            close()
        }
    }
}
