/**
 * 一级菜单下拉内容：编辑入口、添加子菜单与已有子项分组。
 * 复用约定：结构与动作取 @components/ui/dropdown-menu，上限与展示名走 menu/utils/menuTree；
 * 关键约束：目录才渲染子菜单分组，子项达上限时禁用添加，不在此处执行增删改。
 */
import { CirclePlus, SquarePen } from 'lucide-react'
import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@components/ui/dropdown-menu'
import type { WechatMenuButton } from '@shared/types/wechat'
import type { MenuPreviewActions } from './menuPreviewTypes'
import type { JSX } from 'react'
import { canAddSubMenu, isMenuGroup, readMenuDisplayName } from '../utils/menuTree'

interface MenuEntryActionsProps {
    index: number
    button: WechatMenuButton
    actions: Pick<MenuPreviewActions, 'editTop' | 'addSub' | 'editSub'>
}

export function MenuEntryActions({ index, button, actions }: MenuEntryActionsProps): JSX.Element {
    const isGroup = isMenuGroup(button)
    const subButtons = button.subButton ?? []
    return (
        <>
            <DropdownMenuGroup>
                <DropdownMenuLabel>操作</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => actions.editTop(index)}>
                    <SquarePen />
                    {isGroup ? '编辑目录' : '编辑菜单'}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canAddSubMenu(button)} onSelect={() => actions.addSub(index)}>
                    <CirclePlus />
                    添加子菜单
                </DropdownMenuItem>
            </DropdownMenuGroup>
            {isGroup ? (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>子菜单</DropdownMenuLabel>
                        {subButtons.map((child, subIndex) => (
                            <DropdownMenuItem key={child.id} onSelect={() => actions.editSub(index, subIndex)}>
                                <span className="min-w-0 truncate">{readMenuDisplayName(child.name)}</span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuGroup>
                </>
            ) : null}
        </>
    )
}
