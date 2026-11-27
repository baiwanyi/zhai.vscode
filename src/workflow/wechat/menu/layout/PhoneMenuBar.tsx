/**
 * 手机底部菜单条：一级入口等分排布，未满上限时末尾追加添加按钮。
 * 复用约定：入口交给 PhoneMenuEntry，添加按钮取 webview/components/Button，上限取 shared/types/wechat；
 * 关键约束：空菜单时添加按钮占满整行，非空时固定格宽；达平台上限后不再渲染添加入口。
 */
import { cn } from 'cn'
import { CirclePlus } from 'lucide-react'
import { WECHAT_MENU_TOP_LIMIT, type WechatMenuButton } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { PhoneMenuEntry } from './PhoneMenuEntry'
import type { MenuPreviewActions } from './menuPreviewTypes'
import type { JSX } from 'react'

interface PhoneMenuBarProps {
    buttons: WechatMenuButton[]
    activeIndex: number
    actions: Pick<MenuPreviewActions, 'selectTop' | 'editTop' | 'editSub' | 'addSub' | 'addTop'>
}

export function PhoneMenuBar({ buttons, activeIndex, actions }: PhoneMenuBarProps): JSX.Element {
    const canAddTop = buttons.length < WECHAT_MENU_TOP_LIMIT
    return (
        <div className="relative flex h-12 shrink-0 items-center justify-center border-t border-border bg-background">
            {buttons.map((button, index) => (
                <PhoneMenuEntry
                    key={button.id}
                    button={button}
                    index={index}
                    isActive={index === activeIndex}
                    actions={actions}
                />
            ))}
            {canAddTop ? (
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn('h-full rounded-none border-0', buttons.length === 0 ? 'w-full' : 'w-12')}
                    tooltip="添加一级菜单"
                    aria-label="添加一级菜单"
                    onClick={actions.addTop}
                >
                    <CirclePlus />
                </Button>
            ) : null}
        </div>
    )
}
