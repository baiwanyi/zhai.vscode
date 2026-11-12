/**
 * 账号页页脚：账号操作菜单与新建批次入口。
 * 复用约定：外壳槽位取 components/AppPage 的 AppFooter，账号菜单取 layout/WechatAccountMenu（与账号列表行共用），
 * 新建入口取 components/Button；回调由页面注入，本组件不持有状态。
 * 关键约束：批次与账号写操作分别用 isBusy / isAccountBusy 禁用，避免并发提交；
 * 页脚只保留这两个入口——批量选择没有勾选入口，相关界面已一并移除。
 */
import { Plus } from 'lucide-react'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { AppFooter } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { WechatAccountMenu } from './WechatAccountMenu'
import type { JSX } from 'react'

interface WechatPostFooterProps {
    account: WechatAccountSummary
    /** 批次写操作进行中：禁用新建批次 */
    isBusy: boolean
    /** 账号写操作进行中：禁用账号菜单 */
    isAccountBusy: boolean
    onOpenAccountSettings: () => void
    onOpenCredentials: () => void
    onTestAccount: () => void
    onOpenAccountRemove: () => void
    onCreateIssue: () => void
}

export function WechatPostFooter({
    account,
    isBusy,
    isAccountBusy,
    onOpenAccountSettings,
    onOpenCredentials,
    onTestAccount,
    onOpenAccountRemove,
    onCreateIssue,
}: WechatPostFooterProps): JSX.Element {
    return (
        <AppFooter className="justify-between py-1">
            <Button
                size="icon-xs"
                variant="primary"
                disabled={isBusy}
                tooltip="新建批次"
                aria-label="新建批次"
                onClick={onCreateIssue}
            >
                <Plus />
            </Button>
            <WechatAccountMenu
                account={account}
                isDisabled={isAccountBusy}
                showLabel
                align="start"
                onTest={onTestAccount}
                onEdit={onOpenAccountSettings}
                onEditCredentials={onOpenCredentials}
                onRemove={onOpenAccountRemove}
            />
        </AppFooter>
    )
}
