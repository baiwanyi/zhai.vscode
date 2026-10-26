/**
 * 生图上下文菜单：工具栏左一「添加上下文」触发器的下拉，收纳「作品设定」开关与「规则」子菜单。
 * 复用约定：外壳取 @components/ui 的 dropdown-menu，触发器取 @webview/components/Button
 * （尺寸 icon，作品设定或规则挂上时切 secondary 底色）；新建规则弹窗取 @webview/components/FormDialog，
 * 字段取 @components/ui 的 field / input / textarea，文本状态取 @webview/hooks/useTrimmedInput；
 * 规则列表与保存走 ../hooks/usePromptRules，正文由宿主读盘，前端只持有标识。
 * 关键约束：这里的每一项都作为上下文提交，不写进提示词正文；勾选态用 CheckboxItem 承载，
 * 选中与否由输入卡片按芯片算好传入；规则子菜单挂载即重读目录，用户手写 md 后重新打开菜单即可见；
 * 新建只新建不覆盖，重名由宿主拒绝，保存成功后直接把新规则挂成芯片；
 * 上下文在生成中仍可切换（只影响下一次请求），本组件只上抛动作。
 */
import { BookText, Command, FolderOpen, PencilRuler, Plus } from 'lucide-react'
import { useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { PromptRule } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'
import { usePromptRules } from '../hooks/usePromptRules'

interface ImageCommandMenusProps {
    /** 作品设定芯片是否已挂上 */
    isSettingActive: boolean
    /** 已挂规则的标识：子菜单据此回显勾选态 */
    selectedRules: readonly string[]
    onToggleSetting: () => void
    /** 点选规则：由输入卡片切换对应芯片 */
    onToggleRule: (rule: PromptRule) => void
}

interface RuleCreateDialogProps {
    open: boolean
    /** 规则目录的本地路径：写进说明，让用户知道 md 落在哪里 */
    dirPath: string
    isSaving: boolean
    onOpenChange: (isOpen: boolean) => void
    onCreate: (name: string, content: string) => void
}

/** 新建规则弹窗：只收名称与正文，保存目录与文件名由宿主决定 */
function RuleCreateDialog({ open, dirPath, isSaving, onOpenChange, onCreate }: RuleCreateDialogProps): JSX.Element {
    const name = useTrimmedInput()
    const content = useTrimmedInput()
    const isSubmitDisabled = name.isBlank || content.isBlank

    const handleSubmit = (): void => {
        if (isSubmitDisabled) {
            return
        }
        onCreate(name.trimmedValue, content.trimmedValue)
    }

    return (
        <FormDialog
            open={open}
            title="新建规则"
            description={
                dirPath.length > 0
                    ? `以 md 文件保存到 ${dirPath}，勾选后作为上下文并入提示词`
                    : '以 md 文件保存到存储根的 prompt/rules 目录，勾选后作为上下文并入提示词'
            }
            submitLabel="保存"
            isSubmitting={isSaving}
            isSubmitDisabled={isSubmitDisabled}
            contentClassName="sm:max-w-md"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="image-rule-name">名称</FieldLabel>
                <Input
                    id="image-rule-name"
                    value={name.value}
                    placeholder="如：冷色调画面、避免文字水印"
                    className="h-8 px-3 py-1 leading-5"
                    onChange={(event) => name.setValue(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="image-rule-content">规则内容</FieldLabel>
                <Textarea
                    id="image-rule-content"
                    value={content.value}
                    placeholder="用一段话写清画面必须遵守的约束，发送时整段并入提示词"
                    className="min-h-32 text-sm leading-5"
                    onChange={(event) => content.setValue(event.target.value)}
                />
            </Field>
        </FormDialog>
    )
}

export function ImageCommandMenus({
    isSettingActive,
    selectedRules,
    onToggleSetting,
    onToggleRule,
}: ImageCommandMenusProps): JSX.Element {
    const { rules, dirPath, isLoading, isSaving, reload, save, openDir } = usePromptRules()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false)

    /** 菜单底色：作品设定或任一规则挂上即高亮，用户一眼看出已添加了上下文 */
    const isMenuActive = isSettingActive || selectedRules.length > 0

    /** 打开菜单即重读规则目录：用户中途往目录里补 md，再开一次菜单就能看到 */
    const handleMenuOpenChange = (isOpen: boolean): void => {
        setIsMenuOpen(isOpen)
        if (isOpen) {
            void reload()
        }
    }

    /** 保存后自动挂芯片：新建的规则正是用户接下来要用的那条，省去再展开找一遍 */
    const runCreateRule = async (name: string, content: string): Promise<void> => {
        const rule = await save({ name, content })
        if (rule === null) {
            return
        }
        setIsRuleDialogOpen(false)
        onToggleRule(rule)
    }

    const handleCreateRule = (name: string, content: string): void => {
        void runCreateRule(name, content)
    }

    const handleOpenRuleDir = async (): Promise<void> => {
        await openDir()
    }

    return (
        <>
            <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                    <Button
                        size="icon"
                        variant={isMenuActive ? 'secondary' : 'ghost'}
                        tooltip="添加上下文"
                        aria-label="添加上下文"
                    >
                        <Command />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuCheckboxItem checked={isSettingActive} onCheckedChange={() => onToggleSetting()}>
                        <BookText />
                        <span className="flex-1">作品设定</span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <PencilRuler />
                            <span className="flex-1">规则</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                            {rules.length > 0 ? (
                                /* 滚动交给内层：外层不滚动，毛玻璃底色与描边才不会随内容滚出可视区 */
                                <div className="max-h-64 overflow-x-hidden overflow-y-auto">
                                    {rules.map((rule) => (
                                        <DropdownMenuCheckboxItem
                                            key={rule.id}
                                            checked={selectedRules.includes(rule.id)}
                                            title={rule.name}
                                            onCheckedChange={() => onToggleRule(rule)}
                                        >
                                            <span className="flex-1 truncate">{rule.name}</span>
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </div>
                            ) : (
                                <DropdownMenuItem disabled>{isLoading ? '读取中…' : '暂无规则'}</DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setIsRuleDialogOpen(true)}>
                                <Plus />
                                新建规则…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() => {
                                    void handleOpenRuleDir()
                                }}
                            >
                                <FolderOpen />
                                打开规则目录
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                </DropdownMenuContent>
            </DropdownMenu>
            {/* 每次打开换 key 重挂载，字段自然回到空值，不必在子组件里手写重置 */}
            <RuleCreateDialog
                key={isRuleDialogOpen ? 'rule-open' : 'rule-closed'}
                open={isRuleDialogOpen}
                dirPath={dirPath}
                isSaving={isSaving}
                onOpenChange={setIsRuleDialogOpen}
                onCreate={handleCreateRule}
            />
        </>
    )
}
