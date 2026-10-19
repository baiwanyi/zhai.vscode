/**
 * 写作管理页头：左侧返回仪表盘概览，下方为全宽「添加作品」入口。
 * 复用 @components/ui/button 与 lucide 图标；按钮形态与仪表盘顶部操作区保持一致的全宽胶囊。
 * 关键约束：返回是全宽按钮之外唯一的导航入口，不与页面内其他动作重叠；创建进行中禁用添加入口。
 */
import { ArrowLeft, Plus } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { JSX } from 'react'

interface PressTopBarProps {
    isCreating: boolean
    onBack: () => void
    onAdd: () => void
}

export function PressTopBar({ isCreating, onBack, onAdd }: PressTopBarProps): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
                <Button
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full"
                    aria-label="返回仪表盘"
                    onClick={onBack}
                >
                    <ArrowLeft />
                </Button>
                <span className="font-heading text-sm font-semibold">写作管理</span>
            </div>
            <Button
                variant="outline"
                size="lg"
                className="w-full justify-start rounded-full"
                disabled={isCreating}
                onClick={onAdd}
            >
                <Plus data-icon="inline-start" />
                添加作品
            </Button>
        </div>
    )
}
