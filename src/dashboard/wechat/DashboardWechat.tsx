/**
 * 公众号账号列表页（#/wechat）：页头返回入口 + 账号列表 + 底部添加入口 + 账号弹窗与删除确认。
 * 复用约定：外壳取 components/AppPage（页头走 AppHeader、列表走 AppContent 滚动、写操作走 AppFooter），
 * 数据与动作经 hooks/useWechatAccounts 下发，展示口径取 wechat/utils，删除确认走公共 ConfirmDialog。
 * 关键约束：点击账号先写宿主当前账号再跳转，账号页与工作流面板因此共享同一作用域；
 * 新增与编辑共用同一个弹窗实例，以 key 重挂载把表单重置为目标账号的值；
 * 写操作进行中禁用底部入口，删除确认期间两个按钮同时禁用，避免重复提交。
 */
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { useWechatAccounts } from './hooks/useWechatAccounts'
import { WechatAccountDialog } from './layout/WechatAccountDialog'
import { WechatAccountList } from './layout/WechatAccountList'
import type { WechatAccountFormInput } from './hooks/useWechatAccounts'
import type { JSX } from 'react'
import { DashboardBackAction } from '../layout/DashboardBackAction'

interface DashboardWechatProps {
    /** 进入账号页：由路由外壳下发，落地到 #/wechat/{accountId} */
    onOpenAccount: (accountId: string) => void
}

export function DashboardWechat({ onOpenAccount }: DashboardWechatProps): JSX.Element {
    const {
        accounts,
        selectedId,
        status,
        error,
        isMutating,
        isTestingId,
        reload,
        createAccount,
        updateAccount,
        removeAccount,
        testAccount,
        selectAccount,
    } = useWechatAccounts()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    /** 弹窗编辑目标：null 为新建；与 dialogKey 配合，每次打开都重挂载表单 */
    const [dialogAccount, setDialogAccount] = useState<WechatAccountSummary | null>(null)
    const [dialogKey, setDialogKey] = useState(0)
    /** 待删除账号：非 null 即打开确认弹窗 */
    const [pendingRemove, setPendingRemove] = useState<WechatAccountSummary | null>(null)
    /** 页头只在列表就绪时展示数量，加载与失败态不暴露旧快照 */
    const accountCount = status === 'ready' ? accounts.length : 0

    /** 进入账号页：先落当前账号，工作流面板随后按同一账号取数 */
    const handleOpen = useCallback(
        (id: string): void => {
            void selectAccount(id)
            onOpenAccount(id)
        },
        [onOpenAccount, selectAccount],
    )

    const openCreate = useCallback((): void => {
        setDialogAccount(null)
        setDialogKey((previous) => previous + 1)
        setIsDialogOpen(true)
    }, [])

    const openEdit = useCallback((account: WechatAccountSummary): void => {
        setDialogAccount(account)
        setDialogKey((previous) => previous + 1)
        setIsDialogOpen(true)
    }, [])

    /** 提交成功后关闭弹窗；失败保持打开，让用户就地修正输入 */
    const handleSubmit = useCallback(
        async (input: WechatAccountFormInput): Promise<boolean> => {
            const isSaved =
                dialogAccount === null
                    ? (await createAccount(input)) !== null
                    : await updateAccount({ ...input, id: dialogAccount.id })
            if (isSaved) {
                setIsDialogOpen(false)
            }
            return isSaved
        },
        [createAccount, dialogAccount, updateAccount],
    )

    /** 先清空待删除项再提交，避免确认后弹窗还停留在旧数据上 */
    const handleConfirmRemove = useCallback((): void => {
        if (pendingRemove === null) {
            return
        }
        const target = pendingRemove
        setPendingRemove(null)
        void removeAccount(target.id)
    }, [pendingRemove, removeAccount])

    const handleRetry = useCallback((): void => {
        void reload()
    }, [reload])

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>公众号列表</AppTitle>
                    <DashboardBackAction kind="home" />
                    {accountCount > 0 && <AppDescription>{`${String(accountCount)} 个账号`}</AppDescription>}
                </AppHeader>
                <AppContent isScrollable>
                    <WechatAccountList
                        accounts={accounts}
                        selectedId={selectedId}
                        status={status}
                        error={error}
                        isTestingId={isTestingId}
                        isAddDisabled={isMutating}
                        onOpen={handleOpen}
                        onAdd={openCreate}
                        onEdit={openEdit}
                        onTest={(id) => void testAccount(id)}
                        onRemove={setPendingRemove}
                        onRetry={handleRetry}
                    />
                </AppContent>
                <AppFooter>
                    <Button
                        size="icon"
                        variant="primary"
                        disabled={isMutating}
                        tooltip="添加账号"
                        aria-label="添加账号"
                        onClick={openCreate}
                    >
                        <Plus />
                    </Button>
                </AppFooter>
            </AppPage>

            <WechatAccountDialog
                key={dialogKey}
                open={isDialogOpen}
                account={dialogAccount}
                isSubmitting={isMutating}
                onOpenChange={setIsDialogOpen}
                onSubmit={handleSubmit}
            />

            <ConfirmDialog
                open={pendingRemove !== null}
                title="删除公众号账号"
                description={
                    pendingRemove === null
                        ? ''
                        : `将删除「${pendingRemove.name}」的本地配置与已保存密钥，公众号后台的内容不受影响。`
                }
                confirmLabel="删除"
                isDestructive
                isSubmitting={isMutating}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingRemove(null)
                    }
                }}
                onConfirm={handleConfirmRemove}
            />
        </>
    )
}
