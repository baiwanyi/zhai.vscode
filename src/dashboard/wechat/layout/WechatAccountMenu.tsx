/**
 * 账号操作菜单：重新验证连接、关注二维码、账号设置、密钥设置与删除账号，页脚与账号列表行共用。
 * 复用约定：下拉取 @components/ui/dropdown-menu，图标取 lucide，触发器取 components/Button；
 * 账号名标签只在页脚展示（列表行本身已有账号名），对齐方向由调用方决定；二维码入口只发回调，弹窗由页面持有。
 * 关键约束：列表行内使用时必须打开 shouldStopPropagation，否则点菜单会顺带触发整行跳转；
 * 「重新验证连接」在账号未连接时禁用——未配置密钥时鉴权必然失败，先引导用户去填凭据。
 */
import { KeyRound, MoreHorizontal, QrCode, RefreshCw, Settings2, Trash2 } from 'lucide-react'
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
    /** 打开关注二维码：目标账号与弹窗状态由调用方持有 */
    onShowQrcode: () => void
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
    onShowQrcode,
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
                    <RefreshCw />
                    重新验证连接
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isDisabled} onSelect={onShowQrcode}>
                    <QrCode />
                    关注二维码
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isDisabled} onSelect={onEdit}>
                    <Settings2 />
                    账号设置
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isDisabled} onSelect={onEditCredentials}>
                    <KeyRound />
                    密钥设置
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={isDisabled} onSelect={onRemove}>
                    <Trash2 />
                    删除账号
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
