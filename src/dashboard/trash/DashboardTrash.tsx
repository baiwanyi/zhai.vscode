/**
 * 回收站页：列出已删除笔记，支持逐条恢复与彻底删除，以及一键清空。
 * 复用 AppPage 骨架、TrashContent 的内容分派、AlertDialog 与 useConfirmAction 的确认时序；
 * 单条彻底删除的二次确认由 TrashItemRow 内的 DeleteConfirmButton 承担，本页只保留清空确认。
 * 关键约束：彻底删除与清空必须先经二次确认，确认后才触达宿主；
 * 恢复与清除完成后重新拉取回收站快照，列表与条数立即收敛；
 * 有操作在途时禁用全部入口，避免并发清除同一批条目。
 */
import { Trash2 } from 'lucide-react'
import { useState, type JSX } from 'react'
import { AlertDialog } from '@webview/components/AlertDialog'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { TRASH_RETENTION_HINT } from './constants'
import { TrashContent } from './TrashContent'
import { useTrash } from './useTrash'
import { useConfirmAction } from '../hooks/useConfirmAction'
import { useDashboardActions } from '../hooks/useDashboardActions'
import { DashboardBackAction } from '../layout/DashboardBackAction'

export function DashboardTrash(): JSX.Element {
    const { items, status, error, reload } = useTrash()
    const actions = useDashboardActions(reload)
    const [isClearOpen, setIsClearOpen] = useState(false)
    const clearConfirm = useConfirmAction({ close: () => setIsClearOpen(false) })
    const isBusy = actions.pendingAction !== null

    /** 清空在结果落定后才关闭弹窗，整单异常（null）保留弹窗供原地重试 */
    const handleConfirmClear = (): void => {
        clearConfirm.confirm(async () => {
            const result = await actions.clearTrash()
            return result !== null
        })
    }

    return (
        <AppPage>
            <AppHeader align="start">
                <DashboardBackAction kind="home" />
                <AppTitle>回收站</AppTitle>
                <AppAction>
                    <Button
                        variant="destructive"
                        disabled={items.length === 0 || isBusy}
                        onClick={() => setIsClearOpen(true)}
                    >
                        <Trash2 className="size-4" />
                        清空回收站
                    </Button>
                </AppAction>
                <AppDescription>{`共 ${String(items.length)} 项。${TRASH_RETENTION_HINT}`}</AppDescription>
            </AppHeader>

            <AppContent isScrollable className="gap-2">
                <TrashContent
                    status={status}
                    error={error}
                    items={items}
                    isBusy={isBusy}
                    onRestore={(id) => void actions.restoreTrash([id])}
                    onPurge={(id) => void actions.purgeTrash([id])}
                />
            </AppContent>

            {isClearOpen ? (
                <AlertDialog
                    open
                    title="清空回收站？"
                    description={`将彻底删除全部 ${String(items.length)} 项，操作不可恢复。`}
                    confirmLabel="全部清除"
                    isDestructive
                    isSubmitting={actions.isPending('trash-clear')}
                    onOpenChange={clearConfirm.onOpenChange}
                    onConfirm={handleConfirmClear}
                />
            ) : null}
        </AppPage>
    )
}
