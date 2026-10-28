/**
 * 写作管理页底部操作栏：置于 AppPage 的 AppFooter，并排「添加作品」与「导入」两个入口。
 * 复用 @webview/components/Button 与 lucide 图标；两个入口共用全宽胶囊形态，视觉上属于同一组操作。
 * 关键约束：新建与导入互斥，任一进行中同时禁用两个入口，避免并发写同一个作品目录。
 */
import { FileUp, Plus } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface PressFooterActionsProps {
    isBusy: boolean
    onAdd: () => void
    onImport: () => void
}

export function PressFooterActions({ isBusy, onAdd, onImport }: PressFooterActionsProps): JSX.Element {
    return (
        <div className="flex flex-1 items-center justify-between pt-3">
            <Button size="icon" variant="outline" disabled={isBusy} onClick={onAdd} tooltip="添加作品">
                <Plus />
            </Button>
            <Button variant="outline" disabled={isBusy} onClick={onImport}>
                <FileUp />
                导入
            </Button>
        </div>
    )
}
