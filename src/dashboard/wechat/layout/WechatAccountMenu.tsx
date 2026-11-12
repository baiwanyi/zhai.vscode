/**
 * 账号操作菜单：重新验证连接、账号设置、密钥设置与删除账号，账号页页脚与账号列表行共用。
 * 复用约定：下拉取 @components/ui/dropdown-menu，触发器取 components/Button，
 * 账号名标签只在页脚展示（列表行本身已有账号名），对齐方向由调用方决定。
 * 关键约束：列表行内使用时必须打开 shouldStopPropagation，否则点菜单会顺带触发整行跳转；
 * 「重新验证连接」在账号未连接时禁用——未配置密钥时鉴权必然失败，先引导用户去填凭据。
 */
import { MoreHorizontal } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import type { JSX, MouseEvent } from 'react'

interface WechatAccountMenuProps {
    account: WechatAccountSummary
    /** 整体禁用：账号写操作进行中，或该行正在重新鉴权 */
    isDisabled?: boolean
    /** 是否展示账号名标签：页脚需要，列表行不需要 */
    showLabel?: boolean
    align?: 'start' | 'end'
    /** 列表行内菜单：阻止冒泡，避免点菜单顺带跳页 */
    shouldStopPropagation?: boolean
    onTest: () => void
    onEdit: () => void
    onEditCredentials: () => void
    onRemove: () => void
}

export function WechatAccountMenu({
    account,
    isDisabled = false,
    showLabel = false,
    align = 'start',
    shouldStopPropagation = false,
    onTest,
    onEdit,
    onEditCredentials,
    onRemove,
}: WechatAccountMenuProps): JSX.Element {
    const stop = (event: MouseEvent): void => {
        event.stopPropagation()
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon"
                    variant="ghost"
                    aria-label="账号操作"
                    tooltip="账号操作"
                    disabled={isDisabled}
                    onClick={shouldStopPropagation ? stop : undefined}
                >
                    <MoreHorizontal />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} onClick={shouldStopPropagation ? stop : undefined}>
                {showLabel ? (
                    <>
                        <DropdownMenuLabel>{account.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                <DropdownMenuItem disabled={isDisabled || account.status !== 'connected'} onSelect={onTest}>
                    重新验证连接
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onEdit}>账号设置</DropdownMenuItem>
                <DropdownMenuItem onSelect={onEditCredentials}>密钥设置</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                    删除账号
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
