/**
 * 生图上下文菜单：工具栏左一「添加上下文」触发器的下拉，收纳「作品设定」开关与「规则」子菜单。
 * 复用约定：外壳取 @components/ui 的 dropdown-menu，触发器取 @webview/components/Button
 * （作品设定挂上时切 secondary 底色）；规则子菜单与配套弹窗交给同目录 ImageRuleMenu，
 * 规则数据、增删改与弹窗开关统一由 ../hooks/useRuleMenu 编排。
 * 关键约束：这里的每一项都作为上下文提交，不写进提示词正文；选中与否由输入卡片按芯片算好传入；
 * 规则弹窗必须渲染在下拉菜单之外——菜单一收起，其子树连同弹窗一起卸载；
 * 本组件只留菜单开关与两块拼装，不展开规则的具体流程。
 * 上下文在生成中仍可切换（只影响下一次请求），本组件只上抛动作。
 */
import { BookText, Command } from 'lucide-react'
import { useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { PromptRule } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import { ImageRuleDialogs, ImageRuleMenu } from './ImageRuleMenu'
import type { JSX } from 'react'
import { useRuleMenu } from '../hooks/useRuleMenu'

interface ImageCommandMenusProps {
    /** 作品设定芯片是否已挂上 */
    isSettingActive: boolean
    /** 已挂规则的标识：子菜单据此回显挂载态 */
    selectedRules: readonly string[]
    onToggleSetting: () => void
    /** 点选规则：由输入卡片切换对应芯片 */
    onToggleRule: (rule: PromptRule) => void
    /** 规则改名：由输入卡片把已挂芯片换到新标识上 */
    onRenameRule: (previousId: string, rule: PromptRule) => void
    /** 规则被删除：由输入卡片摘掉对应芯片 */
    onRemoveRule: (ruleId: string) => void
}

export function ImageCommandMenus({
    isSettingActive,
    selectedRules,
    onToggleSetting,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
}: ImageCommandMenusProps): JSX.Element {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const ruleMenu = useRuleMenu({
        onToggleRule,
        onRenameRule,
        onRemoveRule,
        onCloseMenu: () => setIsMenuOpen(false),
    })

    /** 打开菜单即重读规则目录：用户中途往目录里补 md，再开一次菜单就能看到 */
    const handleMenuOpenChange = (isOpen: boolean): void => {
        setIsMenuOpen(isOpen)
        if (isOpen) {
            void ruleMenu.reload()
        }
    }

    return (
        <>
            <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="secondary" tooltip="添加上下文" aria-label="添加上下文">
                        <Command />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuCheckboxItem checked={isSettingActive} onCheckedChange={() => onToggleSetting()}>
                        <BookText />
                        <span className="flex-1">作品设定</span>
                    </DropdownMenuCheckboxItem>
                    <ImageRuleMenu
                        rules={ruleMenu.rules}
                        isLoading={ruleMenu.isLoading}
                        selectedRules={selectedRules}
                        onToggle={onToggleRule}
                        onEdit={ruleMenu.edit}
                        onDelete={ruleMenu.requestDelete}
                        onCreate={ruleMenu.create}
                        onOpenDir={ruleMenu.openDir}
                    />
                </DropdownMenuContent>
            </DropdownMenu>
            <ImageRuleDialogs
                form={ruleMenu.formState}
                pendingDelete={ruleMenu.pendingDelete}
                dirPath={ruleMenu.dirPath}
                isSaving={ruleMenu.isSaving}
                onFormClose={ruleMenu.closeForm}
                onFormSubmit={ruleMenu.submit}
                onDeleteClose={ruleMenu.closeDelete}
                onConfirmDelete={ruleMenu.confirmDelete}
            />
        </>
    )
}
