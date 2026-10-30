/**
 * 公众号账号条目：一行呈现头像占位、账号名、类型与认证徽标、元信息或错误提示，
 * 动作区给出当前标记、状态色点与账号操作菜单。
 * 复用 @components/ui 的 item 槽位、badge 徽标与 dropdown-menu 行内菜单，元信息与状态口径取 wechat/utils。
 * 关键约束：整行可点进入账号页，行内菜单与按钮必须阻止冒泡，否则点菜单会顺带跳页；
 * 名称超长时由内层 span 承载 truncate（ItemTitle 自身只裁切、不出现省略号），动作区 shrink-0 不参与压缩；
 * 条目显式 flex-nowrap，窄侧栏遇到长名称时不把头像与动作区挤成两行。
 */
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import type { JSX, MouseEvent } from 'react'
import {
    formatAccountMeta,
    formatAccountStatusHint,
    formatAccountType,
    readAccountInitial,
    WECHAT_STATUS_DOT_CLASS,
    WECHAT_STATUS_LABELS,
} from '../utils'

interface WechatAccountItemProps {
    account: WechatAccountSummary
    /** 是否为当前账号：列表据此显示「当前」徽标 */
    isCurrent: boolean
    /** 该行是否正在重新鉴权：只禁用本行菜单 */
    isTesting: boolean
    onOpen: (id: string) => void
    onEdit: (account: WechatAccountSummary) => void
    onTest: (id: string) => void
    onRemove: (account: WechatAccountSummary) => void
}

export function WechatAccountItem({
    account,
    isCurrent,
    isTesting,
    onOpen,
    onEdit,
    onTest,
    onRemove,
}: WechatAccountItemProps): JSX.Element {
    const isAbnormal = account.status !== 'connected'

    /** 菜单与按钮的点击不参与整行跳转 */
    const stop = (event: MouseEvent): void => {
        event.stopPropagation()
    }

    return (
        <Item
            variant="outline"
            className="cursor-pointer flex-nowrap hover:bg-muted"
            aria-label={`进入公众号 ${account.name}`}
            onClick={() => onOpen(account.id)}
        >
            <ItemMedia>
                <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
                >
                    {readAccountInitial(account.name)}
                </span>
            </ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="w-full items-center gap-1">
                    <span className="block min-w-0 flex-1 truncate">{account.name}</span>
                    <Badge variant="outline" className="shrink-0">
                        {formatAccountType(account)}
                    </Badge>
                    {account.verified && (
                        <Badge variant="secondary" className="shrink-0">
                            认证
                        </Badge>
                    )}
                </ItemTitle>
                <ItemDescription className={isAbnormal ? 'line-clamp-2 text-xs' : 'truncate text-xs'}>
                    {isAbnormal ? formatAccountStatusHint(account) : formatAccountMeta(account)}
                </ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0 gap-1">
                <span
                    className={`size-2 shrink-0 rounded-full ${WECHAT_STATUS_DOT_CLASS[account.status]}`}
                    aria-label={WECHAT_STATUS_LABELS[account.status]}
                    title={WECHAT_STATUS_LABELS[account.status]}
                />
                {isCurrent && (
                    <Badge variant="default" className="shrink-0">
                        当前
                    </Badge>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${account.name} 的操作`}
                            tooltip="账号操作"
                            disabled={isTesting}
                            onClick={stop}
                        >
                            <MoreHorizontal />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={stop}>
                        <DropdownMenuItem disabled={isTesting} onSelect={() => onTest(account.id)}>
                            刷新状态
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onEdit(account)}>账号设置</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onRemove(account)}>
                            删除账号
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </ItemActions>
        </Item>
    )
}
