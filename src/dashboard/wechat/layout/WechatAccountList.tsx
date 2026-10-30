/**
 * 账号列表区块：按加载状态分派，加载中给骨架、失败给重试、无数据给引导、有数据给条目列表。
 * 复用 @components/ui 的 item 与 skeleton、业务公共层的 StateEmpty；标题与数量由页面页头承担。
 * 关键约束：条目组显式声明 w-full，宽度跟随 AppContent 的可用宽度撑满；空态给出两步引导
 * （先配 IP 白名单、再填 AppID 与 AppSecret），未认证账号只能建草稿的须知也在这里说明；
 * 骨架条数与条目同高，等待期间列表不塌陷、也不出现跳动。
 */
import { Plus, UsersRound } from 'lucide-react'
import { ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { WechatAccountItem } from './WechatAccountItem'
import type { WechatListStatus } from '../utils'
import type { JSX } from 'react'

/** 骨架占位 key：固定三条，够覆盖首屏 */
const SKELETON_KEYS = ['w0', 'w1', 'w2'] as const

interface WechatAccountListProps {
    accounts: WechatAccountSummary[]
    selectedId: string | null
    status: WechatListStatus
    error: string | null
    /** 正在重新鉴权的账号 id：透传给条目，只禁用对应行 */
    isTestingId: string | null
    /** 写操作进行中：空态的添加按钮置灰，避免与弹窗提交叠加 */
    isAddDisabled: boolean
    onOpen: (id: string) => void
    onAdd: () => void
    onEdit: (account: WechatAccountSummary) => void
    onTest: (id: string) => void
    onRemove: (account: WechatAccountSummary) => void
    onRetry: () => void
}

export function WechatAccountList({
    accounts,
    selectedId,
    status,
    error,
    isTestingId,
    isAddDisabled,
    onOpen,
    onAdd,
    onEdit,
    onTest,
    onRemove,
    onRetry,
}: WechatAccountListProps): JSX.Element {
    if (status === 'loading') {
        return <AccountSkeleton />
    }

    if (status === 'error') {
        return (
            <StateEmpty title="账号列表加载失败" description={error ?? '请稍后重试'}>
                <Button variant="outline" onClick={onRetry}>
                    重试
                </Button>
            </StateEmpty>
        )
    }

    if (accounts.length === 0) {
        return (
            <StateEmpty
                title="还没有公众号账号"
                description="先在公众号后台把当前出口 IP 加入白名单，再填入 AppID 与 AppSecret。未认证的账号只能创建草稿。"
                icon={UsersRound}
            >
                <Button disabled={isAddDisabled} onClick={onAdd}>
                    <Plus data-icon="inline-start" />
                    添加账号
                </Button>
            </StateEmpty>
        )
    }

    return (
        <ItemGroup className="w-full gap-2">
            {accounts.map((account) => (
                <WechatAccountItem
                    key={account.id}
                    account={account}
                    isCurrent={account.id === selectedId}
                    isTesting={isTestingId === account.id}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onTest={onTest}
                    onRemove={onRemove}
                />
            ))}
        </ItemGroup>
    )
}

/** 加载骨架：与真实条目同高，避免首帧到就绪态发生跳动 */
function AccountSkeleton(): JSX.Element {
    return (
        <div className="flex w-full flex-col gap-2">
            {SKELETON_KEYS.map((key) => (
                <Skeleton key={key} className="h-14 w-full rounded-xl" />
            ))}
        </div>
    )
}
