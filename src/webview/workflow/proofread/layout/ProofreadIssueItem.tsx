/**
 * 单条校对问题：以列表项呈现「原文 → 建议」、判定理由与段落号，并提供应用、定位、忽略三个动作。
 * 复用约定：容器取 @components/ui/item 的槽位，按钮取业务 Button；配色与徽标由外部卡片承担，本文件不重复分级色。
 * 关键约束：只有带确定性替换的条目才出现「应用」按钮，语义类建议不提供一键改写入口；
 * 条目点击不整行触发定位，避免误触把焦点抢到编辑器，定位只由显式按钮发起。
 */
import { Check, LocateFixed, X } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import type { ProofreadIssue } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface ProofreadIssueItemProps {
    issue: ProofreadIssue
    onApply: (issue: ProofreadIssue) => void
    onReveal: (issue: ProofreadIssue) => void
    onIgnore: (issue: ProofreadIssue) => void
}

/** 原文展示：空白片段给出可读占位，避免列表里出现空白行 */
function readQuoteText(issue: ProofreadIssue): string {
    return issue.quote.trim().length > 0 ? issue.quote : '（空白字符）'
}

export function ProofreadIssueItem({ issue, onApply, onReveal, onIgnore }: ProofreadIssueItemProps): JSX.Element {
    const quote = readQuoteText(issue)
    return (
        <Item variant="muted" size="sm">
            <ItemContent className="min-w-0">
                <ItemTitle className="max-w-full min-w-0 gap-1">
                    <span className="min-w-0 truncate">{quote}</span>
                    {issue.replacement === null ? null : (
                        <span className="shrink-0 text-muted-foreground">→ {issue.replacement}</span>
                    )}
                </ItemTitle>
                <ItemDescription>
                    {issue.reason} · 第 {issue.paragraph} 段
                </ItemDescription>
            </ItemContent>
            <ItemActions className="gap-1">
                {issue.replacement === null ? null : (
                    <Button size="xs" variant="ghost" tooltip="应用到文档" onClick={() => onApply(issue)}>
                        <Check />
                        应用
                    </Button>
                )}
                <Button size="xs" variant="ghost" tooltip="在编辑器中定位" onClick={() => onReveal(issue)}>
                    <LocateFixed />
                    定位
                </Button>
                <Button size="xs" variant="ghost" tooltip="本次不再提示" onClick={() => onIgnore(issue)}>
                    <X />
                    忽略
                </Button>
            </ItemActions>
        </Item>
    )
}
