/**
 * 公众号账号列表页（#/wechat）：页头返回入口 + 账号列表 + 底部添加入口 + 账号弹窗、二维码与删除确认。
 * 复用约定：外壳取 components/AppPage（页头走 AppHeader、列表走 AppContent 滚动、写操作走 AppFooter），
 * 数据与动作经 hooks/useWechatAccounts 下发，展示口径取 wechat/utils，删除确认走公共 AlertDialog。
 * 关键约束：列表页不感知工作流区——模块选定与当前账号都由账号页按路径处理，这里只做导航；
 * 新增与编辑共用同一个弹窗实例，以 key 重挂载把表单重置为目标账号的值；
 * 写操作进行中禁用底部入口，删除确认期间两个按钮同时禁用，避免重复提交。
 */
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { AlertDialog } from '@webview/components/AlertDialog'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { useRemountDialog } from './hooks/useRemountDialog'
import { useWechatAccounts } from './hooks/useWechatAccounts'
import { WechatAccountDialog } from './layout/WechatAccountDialog'
import { WechatAccountList } from './layout/WechatAccountList'
import { WechatAccountSecretDialog } from './layout/WechatAccountSecretDialog'
import { WechatQrcodeDialog } from './layout/WechatQrcodeDialog'
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
        testingIds,
        reload,
        createAccount,
        updateAccount,
        saveCredentials,
        removeAccount,
        testAccount,
    } = useWechatAccounts()
    const accountDialog = useRemountDialog()
    /** 弹窗编辑目标：null 为新建；与 accountDialog.key 配合，每次打开都重挂载表单 */
    const [dialogAccount, setDialogAccount] = useState<WechatAccountSummary | null>(null)
    /** 待删除账号：非 null 即打开确认弹窗 */
    const [pendingRemove, setPendingRemove] = useState<WechatAccountSummary | null>(null)
    /** 密钥设置弹窗的目标：非 null 即打开，AppID 与 AppSecret 在这里单独维护 */
    const [secretTarget, setSecretTarget] = useState<WechatAccountSummary | null>(null)
    const secretDialog = useRemountDialog()
    /** 关注二维码目标账号：非 null 即打开弹窗 */
    const [qrcodeTarget, setQrcodeTarget] = useState<WechatAccountSummary | null>(null)
    /** 页头只在列表就绪时展示数量，加载与失败态不暴露旧快照 */
    const accountCount = status === 'ready' ? accounts.length : 0

    /** 进入账号页：只做导航，当前账号由账号页按路径设置 */
    const handleOpen = useCallback(
        (id: string): void => {
            onOpenAccount(id)
        },
        [onOpenAccount],
    )

    const openCreate = useCallback((): void => {
        setDialogAccount(null)
        accountDialog.open()
    }, [accountDialog])

    const openEdit = useCallback((account: WechatAccountSummary): void => {
        setDialogAccount(account)
        accountDialog.open()
    }, [accountDialog])

    /** 提交成功后关闭弹窗；失败保持打开，让用户就地修正输入 */
    const handleSubmit = useCallback(
        async (input: WechatAccountFormInput): Promise<boolean> => {
            const isSaved =
                dialogAccount === null
                    ? (await createAccount(input)) !== null
                    : await updateAccount({ ...input, id: dialogAccount.id })
            if (isSaved) {
                accountDialog.setOpen(false)
            }
            return isSaved
        },
        [accountDialog, createAccount, dialogAccount, updateAccount],
    )

    /** 打开密钥设置：换 key 重挂载，AppID 回填当前值、AppSecret 每次都从空开始 */
    const openCredentials = useCallback((account: WechatAccountSummary): void => {
        setSecretTarget(account)
        secretDialog.open()
    }, [secretDialog])

    /** 保存凭据：成功后关闭弹窗，失败保留让用户就地修正 */
    const handleCredentialsSubmit = useCallback(
        async (input: { appId: string; appSecret: string }): Promise<boolean> => {
            if (secretTarget === null) {
                return false
            }
            const isSaved = await saveCredentials({ id: secretTarget.id, ...input })
            if (isSaved) {
                setSecretTarget(null)
            }
            return isSaved
        },
        [saveCredentials, secretTarget],
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
            <AppPage>
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
                        testingIds={testingIds}
                        isAddDisabled={isMutating}
                        onOpen={handleOpen}
                        onAdd={openCreate}
                        onEdit={openEdit}
                        onEditCredentials={openCredentials}
                        onTest={(id) => void testAccount(id)}
                        onShowQrcode={setQrcodeTarget}
                        onRemove={setPendingRemove}
                        onRetry={handleRetry}
                    />
                </AppContent>
                <AppFooter className="pt-2">
                    <Button
                        size="icon-xs"
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
                key={accountDialog.key}
                open={accountDialog.isOpen}
                account={dialogAccount}
                isSubmitting={isMutating}
                onOpenChange={accountDialog.setOpen}
                onSubmit={handleSubmit}
            />

            {secretTarget !== null && (
                <WechatAccountSecretDialog
                    key={secretDialog.key}
                    open
                    account={secretTarget}
                    isSubmitting={isMutating}
                    onOpenChange={(open) => {
                        if (!open) {
                            setSecretTarget(null)
                        }
                    }}
                    onSubmit={handleCredentialsSubmit}
                />
            )}

            {qrcodeTarget !== null && (
                <WechatQrcodeDialog
                    account={qrcodeTarget}
                    onOpenChange={(open) => {
                        if (!open) {
                            setQrcodeTarget(null)
                        }
                    }}
                />
            )}

            <AlertDialog
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
