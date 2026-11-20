/**
 * 微博顶栏「更多」菜单：把设置页入口与登录 Cookie 动作从导航行收进下拉，
 * 导航行只留信息流切换，动作区在窄面板下不再被挤满。
 * 复用约定：触发按钮取 @webview/components/Button，菜单壳取 @components/ui/dropdown-menu，
 * 当前所在页由页面传入，本组件不持有视图与凭证状态。
 * 关键约束：菜单宽度必须显式给定 —— Radix 默认按触发按钮宽度撑开，「更多」按钮很窄，
 * 长文案会被挤成多行；凭证卡只存在于首页（按需）与设置页（常驻），
 * 故 Cookie 项的行为由页面实现为「回首页并展开凭证卡」，组件不自行切页。
 */
import { Check, Cookie, EllipsisVertical, Settings2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 触发按钮文案：按钮可见文字与 tooltip 同源，读屏与视觉提示不各写一份 */
const MORE_LABEL = '更多'

interface WeiboMoreMenuProps {
    /** 当前是否停在设置页：菜单里用勾选标记所在页，避免用户不知道自己在哪一页 */
    isSettingsActive: boolean
    onOpenSettings: () => void
    /** 更新或清除登录 Cookie：凭据面板的展开与切页由页面负责 */
    onOpenCredential: () => void
}

export function WeiboMoreMenu({ isSettingsActive, onOpenSettings, onOpenCredential }: WeiboMoreMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" tooltip="设置与登录 Cookie">
                    <EllipsisVertical className="size-3.5" aria-hidden="true" />
                    {MORE_LABEL}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={onOpenSettings}>
                    <Settings2 />
                    设置
                    {isSettingsActive ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenCredential}>
                    <Cookie />
                    登录 Cookie
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
