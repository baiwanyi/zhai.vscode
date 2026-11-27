/**
 * 一级菜单入口：触发器保留等分格外观，编辑与子菜单操作统一收进下拉菜单。
 * 复用约定：按钮取 webview/components/Button，下拉内容交给 MenuEntryActions；
 * 关键约束：点击触发器只切换激活态，真正编辑走下拉项，目录与叶子用图标与提示区分。
 */
import { Menu } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import type { WechatMenuButton } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { MenuEntryActions } from './MenuEntryActions'
import type { MenuPreviewActions } from './menuPreviewTypes'
import type { JSX } from 'react'
import { isMenuGroup, readMenuDisplayName } from '../utils/menuTree'

interface PhoneMenuEntryProps {
    button: WechatMenuButton
    index: number
    isActive: boolean
    actions: Pick<MenuPreviewActions, 'selectTop' | 'editTop' | 'editSub' | 'addSub'>
}

export function PhoneMenuEntry({ button, index, isActive, actions }: PhoneMenuEntryProps): JSX.Element {
    const isGroup = isMenuGroup(button)
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant={isActive ? 'primary' : 'ghost'}
                    className="h-full min-w-0 flex-1 gap-1.5 rounded-none border-0"
                    tooltip={isGroup ? '展开子菜单' : '编辑菜单'}
                    aria-label={isGroup ? `展开「${button.name}」的子菜单` : `编辑「${button.name}」`}
                    onClick={() => actions.selectTop(index)}
                >
                    <span className="min-w-0 truncate">{readMenuDisplayName(button.name)}</span>
                    {isGroup && <Menu data-icon="inline-end" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-44">
                <MenuEntryActions index={index} button={button} actions={actions} />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
