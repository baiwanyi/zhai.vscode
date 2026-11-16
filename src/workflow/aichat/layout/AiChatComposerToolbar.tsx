/**
 * AI 对话输入卡片顶部工具行：左侧「添加上下文」、右侧「更多」，严格保持两个按钮。
 * 采用普通行容器承载两个独立菜单组件，本层持有上下文面板开关与规则菜单编排。
 * 关键约束：工具行内不放入设置、会话等其它入口，避免与模板的两个按钮约定冲突；
 * 上下文面板挂在 Popover 上而不是菜单内——菜单里的输入框会被 Radix 的键盘事件拦截；
 * 规则的新建 / 编辑 / 删除弹窗必须渲染在菜单之外，菜单收起会卸载整棵子树；
 * 留白由外层 AppComposerHeader 的 p-1 提供，本层不再自带 padding，否则会叠加成双重缩进。
 */
import { useState } from 'react'
import { Popover, PopoverAnchor } from '@components/ui/popover'
import type { PromptRule } from '@shared/types/imagegen'
import { RuleDialogs } from '@webview/components/RuleDialogs'
import { useRuleMenu } from '@webview/hooks/useRuleMenu'
import { AiChatContextMenu } from './AiChatContextMenu'
import { AiChatContextPicker } from './AiChatContextPicker'
import { AiChatReferenceMenu } from './AiChatReferenceMenu'
import type { AiContextPickerView, AiReferenceAction } from '../constants'
import type { JSX } from 'react'

interface AiChatComposerToolbarProps {
    disabled: boolean
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：复用「更多」菜单入口，不额外占用工具行按钮 */
    onMention: () => void
    /** 上下文添加成功后刷新清单 */
    onContextAdded: () => void
    /** 上下文添加失败的提示出口 */
    onContextError: (error: string) => void
    /** 已挂规则名：规则子菜单据此回显挂载态 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
}

export function AiChatComposerToolbar({
    disabled,
    onReference,
    onMention,
    onContextAdded,
    onContextError,
    ruleNames,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
}: AiChatComposerToolbarProps): JSX.Element {
    const [isPickerOpen, setIsPickerOpen] = useState(false)
    const [pickerView, setPickerView] = useState<AiContextPickerView | null>(null)
    const [isMenuOpen, setIsMenuOpen] = useState(false)

    const ruleMenu = useRuleMenu({
        onToggleRule,
        onRenameRule,
        onRemoveRule,
        onCloseMenu: (): void => setIsMenuOpen(false),
    })

    const openPicker = (view: AiContextPickerView): void => {
        setPickerView(view)
        setIsPickerOpen(true)
    }

    const closePicker = (): void => {
        setIsPickerOpen(false)
    }

    /** 打开菜单即重读规则目录：用户中途往目录里补 md，再开一次就能看到 */
    const handleMenuOpenChange = (isOpen: boolean): void => {
        setIsMenuOpen(isOpen)
        if (isOpen) {
            void ruleMenu.reload()
        }
    }

    return (
        <>
            <Popover open={isPickerOpen} onOpenChange={(next): void => setIsPickerOpen(next)}>
                <PopoverAnchor asChild>
                    <div className="flex items-center gap-0.5">
                        <AiChatContextMenu
                            disabled={disabled}
                            onSelect={openPicker}
                            rules={ruleMenu.rules}
                            isLoadingRules={ruleMenu.isLoading}
                            selectedRules={ruleNames}
                            onToggleRule={onToggleRule}
                            onEditRule={ruleMenu.edit}
                            onDeleteRule={ruleMenu.requestDelete}
                            onCreateRule={ruleMenu.create}
                            onOpenRuleDir={ruleMenu.openDir}
                            open={isMenuOpen}
                            onOpenChange={handleMenuOpenChange}
                        />
                        <AiChatReferenceMenu disabled={disabled} onReference={onReference} onMention={onMention} />
                    </div>
                </PopoverAnchor>
                <AiChatContextPicker
                    view={pickerView}
                    onViewChange={setPickerView}
                    onClose={closePicker}
                    onAdded={onContextAdded}
                    onError={onContextError}
                />
            </Popover>
            <RuleDialogs
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
