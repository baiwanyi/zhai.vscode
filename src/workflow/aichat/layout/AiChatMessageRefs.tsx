/**
 * AI 对话用户消息首行的引用徽章组：随命令徽章同行排列，由调用方提供布局容器。
 * 复用 @components/ui 的 Badge / tooltip、@webview/components/Tooltip 的暗底提示类，
 * 以及 ../utils 的文件名折算与 @shared/utils/zhaiPath 的 @zhai 展示路径折算，纯展示组件。
 * 关键约束：徽章只展示文件名，完整存储根路径经 tooltip 给出 —— 原生 title 不带主题样式也不受控，不再使用；
 * 提示气泡固定暗底白字（复用 TOOLTIP_CLASS 的变量覆盖让箭头同色），不随明暗主题翻转；
 * 徽章配色随用户气泡前景色，不做独立底色；
 * 与命令徽章统一 align-top，依赖调用方的 20px 行高（leading-5）与徽章高度重合。
 */
import { cn } from 'cn'
import { Badge } from '@components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { AiContextRef } from '@shared/types/aiChat'
import { toZhaiDisplayPath } from '@shared/utils/zhaiPath'
import { TOOLTIP_CLASS } from '@webview/components/Tooltip'
import type { JSX } from 'react'
import { toContextFileName } from '../utils'

interface AiChatMessageRefsProps {
    refs: AiContextRef[]
}

export function AiChatMessageRefs({ refs }: AiChatMessageRefsProps): JSX.Element | null {
    if (refs.length === 0) {
        return null
    }
    return (
        <>
            {refs.map((ref) => (
                <Tooltip key={ref.id}>
                    <TooltipTrigger asChild>
                        <Badge
                            variant="secondary"
                            className="mr-1.5 max-w-56 border-0 bg-primary-foreground/15 align-top font-normal text-primary-foreground"
                        >
                            <span className="min-w-0 truncate">{toContextFileName(ref)}</span>
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className={cn(TOOLTIP_CLASS, 'max-w-72 text-white')}>
                        <span className="break-all">{toZhaiDisplayPath(ref.displayPath)}</span>
                    </TooltipContent>
                </Tooltip>
            ))}
        </>
    )
}
