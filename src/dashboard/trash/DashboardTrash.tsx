/**
 * 回收站页：列出已删除笔记，支持逐条恢复与彻底删除，以及一键清空。
 * 复用 AppPage 骨架、TrashContent 的内容分派、ConfirmDialog 与 useConfirmAction 的确认时序。
 * 关键约束：彻底删除与清空必须先经二次确认，确认后才触达宿主；
 * 恢复与清除完成后重新拉取回收站快照，列表与条数立即收敛；
 * 有操作在途时禁用全部入口，避免并发清除同一批条目。
 */
import { Trash2 } from 'lucide-react'
import { useState, type JSX } from 'react'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { TRASH_RETENTION_HINT } from './constants'
import { TrashContent } from './TrashContent'
import { useTrash } from './useTrash'
import { useConfirmAction } from '../hooks/useConfirmAction'
import { useDashboardActions } from '../hooks/useDashboardActions'
import { DashboardBackAction } from '../layout/DashboardBackAction'

export function DashboardTrash(): JSX.Element {
    const { items, status, error, reload } = useTrash()
    const actions = useDashboardActions(reload)
    /** 待彻底删除的条目 id 集合：空集合即确认弹窗关闭 */
    const [purgeIds, setPurgeIds] = useState<string[]>([])
    const [isClearOpen, setIsClearOpen] = useState(false)
    const purgeConfirm = useConfirmAction({ close: () => setPurgeIds([]) })
    const clearConfirm = useConfirmAction({ close: () => setIsClearOpen(false) })
    const isBusy = actions.pendingAction !== null

    /** 彻底清除与清空都在结果落定后才关闭弹窗，整单异常（null）保留弹窗供原地重试 */
    const handleConfirmPurge = (): void => {
        const targets = purgeIds
        purgeConfirm.confirm(async () => {
            const result = await actions.purgeTrash(targets)
            return result !== null
        })
    }

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
                    onPurge={(id) => setPurgeIds([id])}
                />
            </AppContent>

            {purgeIds.length > 0 ? (
                <ConfirmDialog
                    open
                    title={`彻底删除 ${String(purgeIds.length)} 项？`}
                    description="彻底删除后无法恢复，原笔记文件将从磁盘移除。"
                    confirmLabel="彻底删除"
                    isDestructive
                    isSubmitting={actions.pendingAction === 'trash-purge'}
                    onOpenChange={purgeConfirm.onOpenChange}
                    onConfirm={handleConfirmPurge}
                />
            ) : null}

            {isClearOpen ? (
                <ConfirmDialog
                    open
                    title="清空回收站？"
                    description={`将彻底删除全部 ${String(items.length)} 项，操作不可恢复。`}
                    confirmLabel="全部清除"
                    isDestructive
                    isSubmitting={actions.pendingAction === 'trash-clear'}
                    onOpenChange={clearConfirm.onOpenChange}
                    onConfirm={handleConfirmClear}
                />
            ) : null}
        </AppPage>
    )
}
