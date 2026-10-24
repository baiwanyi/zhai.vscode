/**
 * 单条校对问题：以列表项呈现「原文 → 建议」、判定理由与段落号，并提供应用、定位、忽略三个动作。
 * 复用约定：容器取 @components/ui/item 的槽位，按钮取业务 Button；配色与徽标由外部卡片承担，本文件不重复分级色。
 * 关键约束：只有带确定性替换的条目才出现「应用」按钮，语义类建议不提供一键改写入口；
 * 条目点击不整行触发定位，避免误触把焦点抢到编辑器，定位只由显式按钮发起；
 * 原文与建议在同一行内裁切，判定理由用普通段落按容器宽度完整换行；Item 的 ItemTitle / ItemDescription
 * 默认带 line-clamp，会把容器切成 -webkit-box 让子项按内容宽度排版、溢出卡片，故两处都不沿用默认截断。
 */
import { ArrowRight, Check, LocateFixed, X } from 'lucide-react'
import { Badge } from '@components/ui/badge'
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
        <Item variant="muted" size="sm" className="flex-nowrap items-start">
            <ItemContent>
                <ItemTitle className="flex max-w-full min-w-0 items-center gap-2 text-white text-sm mb-2">
                    <span>{quote}</span>
                    {issue.replacement && (
                        <>
                            <div className="bg-white/10 p-1 rounded-md">
                                <ArrowRight className="size-3" />
                            </div>
                            <span>{issue.replacement}</span>
                        </>
                    )}
                </ItemTitle>
                <ItemDescription>
                    <Badge variant="outline">{issue.paragraph}</Badge>
                    <span className="pl-1 text-xs text-muted-foreground">{issue.reason}</span>
                </ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0 gap-1 items-start">
                {issue.replacement === null ? null : (
                    <Button size="icon-xs" tooltip="应用到文档" onClick={() => onApply(issue)}>
                        <Check />
                    </Button>
                )}
                <Button size="icon-xs" variant="outline" tooltip="在编辑器中定位" onClick={() => onReveal(issue)}>
                    <LocateFixed />
                </Button>
                <Button size="icon-xs" variant="destructive" tooltip="本次不再提示" onClick={() => onIgnore(issue)}>
                    <X />
                </Button>
            </ItemActions>
        </Item>
    )
}
