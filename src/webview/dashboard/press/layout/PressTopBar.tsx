/**
 * 写作管理页头：左侧返回仪表盘概览，下方为并排的「添加作品」与「导入」入口。
 * 复用 @webview/components/Button 与 lucide 图标；返回入口用 icon 尺寸，悬浮说明经该组件的 tooltip 参数给出；
 * 两个入口共用全宽胶囊形态，视觉上属于同一组操作。
 * 关键约束：返回是全宽按钮之外唯一的导航入口，不与页面内其他动作重叠；
 * 新建与导入互斥，任一进行中同时禁用两个入口，避免并发写同一个作品目录。
 */
import { ArrowLeft, FileUp, Plus } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface PressTopBarProps {
    isCreating: boolean
    isImporting: boolean
    onBack: () => void
    onAdd: () => void
    onImport: () => void
}

export function PressTopBar({ isCreating, isImporting, onBack, onAdd, onImport }: PressTopBarProps): JSX.Element {
    const isBusy = isCreating || isImporting
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label="返回仪表盘"
                    tooltip="返回仪表盘"
                    onClick={onBack}
                >
                    <ArrowLeft />
                </Button>
                <span className="font-heading font-semibold">写作管理</span>
            </div>
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    className="flex-1 justify-start rounded-full"
                    disabled={isBusy}
                    onClick={onAdd}
                >
                    <Plus data-icon="inline-start" />
                    添加作品
                </Button>
                <Button
                    variant="outline"
                    className="flex-1 justify-start rounded-full"
                    disabled={isBusy}
                    onClick={onImport}
                >
                    <FileUp data-icon="inline-start" />
                    导入
                </Button>
            </div>
        </div>
    )
}
