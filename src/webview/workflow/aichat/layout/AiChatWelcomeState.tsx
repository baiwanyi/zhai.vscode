/**
 * AI 对话欢迎态：无消息且已配置密钥时的居中引导，介绍发送方式与「添加到宅对话」入口。
 * 复用 @/components/ui 的 empty 组件标准用法，为纯展示组件、无任何回调依赖。
 */
import { Sparkles } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { JSX } from 'react'

/** 欢迎态：无消息时的居中引导（Empty 组件的标准用法） */
export function AiChatWelcomeState(): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <Sparkles className="size-5" />
                </EmptyMedia>
                <EmptyTitle>开始新的对话</EmptyTitle>
                <EmptyDescription>
                    输入问题后按 Enter 发送，Shift + Enter
                    换行；在编辑器中右键「添加到宅对话」可把文件或选中行加入上下文。
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
