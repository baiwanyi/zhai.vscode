/**
 * 作品详情页头：左侧返回作品列表，中间作品名，右侧打开作品设定（README）。
 * 复用 @components/ui/button 与 lucide 图标；标题超长时单行截断，避免窄侧栏把按钮挤出可视区。
 * 关键约束：返回只回到作品列表（不是概览首页），由页面层下发回调；
 * 打开设定与打开章节是两条独立协议，此处的按钮只负责前者。
 */
import { ArrowLeft, FileText } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { JSX } from 'react'

interface PressProjectHeaderProps {
    title: string
    onBack: () => void
    onOpenReadme: () => void
}

export function PressProjectHeader({ title, onBack, onOpenReadme }: PressProjectHeaderProps): JSX.Element {
    return (
        <div className="flex items-center gap-1">
            <Button variant="ghost" className="size-7 p-0 rounded-full" aria-label="返回作品列表" onClick={onBack}>
                <ArrowLeft />
            </Button>
            <span className="min-w-0 flex-1 truncate font-heading font-semibold">{title}</span>
            <Button
                variant="ghost"
                className="size-7 p-0 rounded-full"
                aria-label="打开作品设定"
                title="打开作品设定"
                onClick={onOpenReadme}
            >
                <FileText />
            </Button>
        </div>
    )
}
