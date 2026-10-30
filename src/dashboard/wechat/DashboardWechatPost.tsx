/**
 * 公众号账号页（#/wechat/{accountId}）：显示账号名与状态，承载批次（文章）列表的落点与账号级操作。
 * 复用约定：外壳取 components/AppPage，账号数据与动作经 hooks/useWechatAccounts 下发，
 * 展示口径取 wechat/utils，账号设置弹窗与删除确认分别取 WechatAccountDialog 与公共 ConfirmDialog。
 * 关键约束：本页按 accountId 从账号快照中定位，切换账号由路由外壳重新挂载本页（key 为 accountId）；
 * 账号不存在（被删除或 hash 手改）时给出回到列表的出口，不渲染空白页；
 * 批次（文章）列表尚未接入，内容区给出明确的空态，而不是假装加载中；
 * 页脚的「+」保持禁用并说明原因，避免用户以为功能失效。
 */
import { MoreHorizontal, Plus, Send } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useWechatAccounts } from './hooks/useWechatAccounts'
import { WechatAccountDialog } from './layout/WechatAccountDialog'
import { formatAccountMeta, formatAccountStatusHint, WECHAT_STATUS_LABELS } from './utils'
import type { WechatAccountFormInput } from './hooks/useWechatAccounts'
import type { JSX } from 'react'
import { DashboardBackAction } from '../layout/DashboardBackAction'

interface DashboardWechatPostProps {
    /** 当前账号 id：由路由外壳下发，来自 #/wechat/{accountId} */
    accountId: string
    /** 账号被删除后的出口：由路由外壳下发，回到账号列表 */
    onRemoved: () => void
}

export function DashboardWechatPost({ accountId, onRemoved }: DashboardWechatPostProps): JSX.Element {
    const { accounts, status, isMutating, updateAccount, removeAccount, testAccount } = useWechatAccounts()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [dialogKey, setDialogKey] = useState(0)
    const [isRemoveOpen, setIsRemoveOpen] = useState(false)
    const account = useMemo(() => accounts.find((item) => item.id === accountId) ?? null, [accountId, accounts])

    const handleSubmit = useCallback(
        async (input: WechatAccountFormInput): Promise<boolean> => {
            const isSaved = await updateAccount({ ...input, id: accountId })
            if (isSaved) {
                setIsDialogOpen(false)
            }
            return isSaved
        },
        [accountId, updateAccount],
    )

    const openSettings = useCallback((): void => {
        setDialogKey((previous) => previous + 1)
        setIsDialogOpen(true)
    }, [])

    /** 先关确认弹窗再提交，删除成功后由路由外壳带回列表 */
    const handleConfirmRemove = useCallback((): void => {
        setIsRemoveOpen(false)
        void removeAccount(accountId).then((isRemoved) => {
            if (isRemoved) {
                onRemoved()
            }
        })
    }, [accountId, onRemoved, removeAccount])

    if (status === 'loading') {
        return (
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>正在读取账号…</AppTitle>
                    <DashboardBackAction kind="back" />
                </AppHeader>
                <AppContent />
            </AppPage>
        )
    }

    if (account === null) {
        return (
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>账号不存在</AppTitle>
                    <DashboardBackAction kind="back" />
                </AppHeader>
                <AppContent>
                    <StateEmpty
                        title="找不到该公众号账号"
                        description="账号可能已被删除，或链接里的标识不完整。"
                        icon={Send}
                    >
                        <Button variant="outline" onClick={onRemoved}>
                            返回账号列表
                        </Button>
                    </StateEmpty>
                </AppContent>
            </AppPage>
        )
    }

    const statusText =
        account.status === 'connected'
            ? formatAccountMeta(account)
            : `${WECHAT_STATUS_LABELS[account.status]} · ${formatAccountStatusHint(account)}`

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle tooltip={account.name}>{account.name}</AppTitle>
                    <DashboardBackAction kind="back" />
                    <AppDescription>{statusText}</AppDescription>
                </AppHeader>
                <AppContent isScrollable>
                    <StateEmpty
                        title="还没有推送批次"
                        description="一次推送即一个批次，批次内的文章从笔记或作品导入。批次编辑与推送将在下一步接入。"
                        icon={Send}
                        iconClassName="size-12 rounded-2xl"
                    >
                        <Button
                            variant="outline"
                            disabled={isMutating || account.status !== 'connected'}
                            onClick={() => void testAccount(accountId)}
                        >
                            重新验证连接
                        </Button>
                    </StateEmpty>
                </AppContent>
                <AppFooter className="justify-between">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label="账号操作" tooltip="账号操作">
                                <MoreHorizontal />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuLabel>{account.name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={openSettings}>账号设置</DropdownMenuItem>
                            <DropdownMenuItem onSelect={openSettings}>密钥设置</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setIsRemoveOpen(true)}>
                                删除账号
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        size="icon"
                        variant="primary"
                        disabled
                        tooltip="批次编辑将在下一步接入"
                        aria-label="新建批次（暂未开放）"
                    >
                        <Plus />
                    </Button>
                </AppFooter>
            </AppPage>

            <WechatAccountDialog
                key={dialogKey}
                open={isDialogOpen}
                account={account}
                isSubmitting={isMutating}
                onOpenChange={setIsDialogOpen}
                onSubmit={handleSubmit}
            />

            <ConfirmDialog
                open={isRemoveOpen}
                title="删除公众号账号"
                description={`将删除「${account.name}」的本地配置与已保存密钥，公众号后台的内容不受影响。`}
                confirmLabel="删除"
                isDestructive
                isSubmitting={isMutating}
                onOpenChange={setIsRemoveOpen}
                onConfirm={handleConfirmRemove}
            />
        </>
    )
}
