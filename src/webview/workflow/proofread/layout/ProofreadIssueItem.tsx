/**
 * 单条校对问题：以列表项呈现「原文 → 建议」、段落号与判定理由，并提供应用、定位、忽略三个动作。
 * 复用约定：容器取 @components/ui/item 的槽位，按钮取业务 Button；配色与徽标由外部卡片承担，本文件不重复分级色。
 * 关键约束：只有带确定性替换（replacement 非 null）的条目才出现「应用」，语义类建议不提供一键改写入口；
 * 条目点击不整行触发定位，避免误触把焦点抢到编辑器，定位只由显式按钮发起；
 * 标题行须以 line-clamp-none 退出 ItemTitle 默认截断（-webkit-box 会让内部 flex 子项按内容宽排版而溢出被裁），
 * 且该类别名必须写在 flex / overflow-hidden 之前，否则 cn 会把这两个布局类一并判为冲突删掉；
 * 原文与建议各自 min-w-0 truncate，颜色一律取主题令牌，不写死白色以免浅色主题下文字与底色同色。
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

/** 建议展示：空替换表示删掉该片段，给出可读占位而不是留白 */
function readReplacementText(replacement: string): string {
    return replacement.length > 0 ? replacement : '（删除）'
}

export function ProofreadIssueItem({ issue, onApply, onReveal, onIgnore }: ProofreadIssueItemProps): JSX.Element {
    const quote = readQuoteText(issue)
    // 是否可一键写回只认 null：空串属于「删除该片段」，同样要显示建议与「应用」按钮
    const replacement = issue.replacement === null ? null : readReplacementText(issue.replacement)

    return (
        <Item variant="muted" size="sm" className="flex-nowrap items-start">
            <ItemContent>
                {/* line-clamp-none 必须排在 flex / overflow-hidden 之前：cn 把 line-clamp 视为与 display、
                    overflow 冲突，写在后面会连自己需要的布局类一起删掉 */}
                <ItemTitle className="line-clamp-none mb-2 flex w-full min-w-0 items-center gap-2 overflow-hidden text-sm">
                    <span className="min-w-0 truncate">{quote}</span>
                    {replacement !== null && (
                        <>
                            <div className="shrink-0 rounded-md bg-foreground/10 p-1">
                                <ArrowRight className="size-3" />
                            </div>
                            <span className="min-w-0 truncate">{replacement}</span>
                        </>
                    )}
                </ItemTitle>
                <ItemDescription>
                    <Badge variant="outline">{issue.paragraph}</Badge>
                    <span className="pl-1 text-xs text-muted-foreground">{issue.reason}</span>
                </ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0 items-start gap-1">
                {replacement !== null && (
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
