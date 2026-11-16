/**
 * 「添加上下文」入口：触发器按钮加单层 Popover，内部挂 AiChatContextPicker 选择器。
 * 复用约定：外壳取 @components/ui 的 popover，触发器取 @webview/components/Button，
 * 规则数据与增删改统一由 @webview/hooks/useRuleMenu 编排，弹窗取 @webview/components/RuleDialogs。
 * 关键约束：一级列表与二级视图都在同一个 Popover 内切换——早先用下拉菜单去打开面板，
 * 两层浮层同帧一关一开会把面板判成外部交互而立即收起（表现为闪退）；
 * 规则弹窗必须渲染在浮层之外，面板收起不会连带卸载它；
 * 打开面板时回到根视图并重读规则目录，关闭时同样复位视图，下次仍从根开始。
 */
import { Command } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import type { PromptRule } from '@shared/types/promptLibrary'
import { Button } from '@webview/components/Button'
import { RuleDialogs } from '@webview/components/RuleDialogs'
import { useRuleMenu } from '@webview/hooks/useRuleMenu'
import { AiChatContextPicker } from './AiChatContextPicker'
import type { AiContextPickerView } from '../constants'
import type { JSX } from 'react'

interface AiChatContextMenuProps {
    disabled: boolean
    /** 上下文添加成功后刷新会话快照 */
    onContextAdded: () => void
    /** 上下文添加失败的提示出口 */
    onContextError: (error: string) => void
    /** 已挂规则名：选择器的规则视图据此回显挂载态 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
}

/** 选择器初始视图：每次打开都从根列表开始 */
const ROOT_VIEW: AiContextPickerView = { mode: 'root' }

export function AiChatContextMenu({
    disabled,
    onContextAdded,
    onContextError,
    ruleNames,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
}: AiChatContextMenuProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [pickerView, setPickerView] = useState<AiContextPickerView>(ROOT_VIEW)

    const ruleMenu = useRuleMenu({
        onToggleRule,
        onRenameRule,
        onRemoveRule,
        // 编辑与删除要先收起面板再弹窗，否则两层浮层会叠在一起
        onCloseMenu: (): void => setIsOpen(false),
    })

    /** 面板开合：打开时重读规则目录，开合都复位视图 */
    const handleOpenChange = (isOpen: boolean): void => {
        setIsOpen(isOpen)
        setPickerView(ROOT_VIEW)
        if (isOpen) {
            void ruleMenu.reload()
        }
    }

    return (
        <>
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="secondary"
                        size="icon"
                        tooltip="添加上下文"
                        aria-label="添加上下文"
                        disabled={disabled}
                    >
                        <Command />
                    </Button>
                </PopoverTrigger>
                {/* 外观对齐下拉菜单：p-1、半透明毛玻璃底、菜单项圆角高亮，宽度与参考资料菜单一致 */}
                <PopoverContent
                    align="start"
                    side="top"
                    className="relative w-56 gap-0 overflow-x-hidden overflow-y-auto rounded-lg bg-popover/70 p-1 shadow-md ring-1 ring-foreground/10 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150"
                    onOpenAutoFocus={(event): void => event.preventDefault()}
                >
                    <AiChatContextPicker
                        view={pickerView}
                        onViewChange={setPickerView}
                        onClose={(): void => setIsOpen(false)}
                        onAdded={onContextAdded}
                        onError={onContextError}
                        rules={ruleMenu.rules}
                        isLoadingRules={ruleMenu.isLoading}
                        selectedRules={ruleNames}
                        onToggleRule={onToggleRule}
                        onEditRule={ruleMenu.edit}
                        onDeleteRule={ruleMenu.requestDelete}
                        onCreateRule={ruleMenu.create}
                        onOpenRuleDir={ruleMenu.openDir}
                    />
                </PopoverContent>
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
