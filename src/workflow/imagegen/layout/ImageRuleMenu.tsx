/**
 * 生图「规则」子菜单与配套弹窗：子菜单列出规则 md，行内完成挂载、编辑与删除；弹窗承担表单与删除确认。
 * 复用约定：子菜单与菜单项取 @components/ui 的 dropdown-menu，行尾操作取 @webview/components/Button，
 * 表单取 @webview/components/FormDialog，删除确认取 @webview/components/ConfirmDialog，
 * 文本状态取 @webview/hooks/useTrimmedInput，类型取 @shared/types/imagegen。
 * 关键约束：子菜单与弹窗必须分开渲染——菜单收起会卸载子菜单整棵子树，弹窗挂在其内会随之消失，
 * 因此 ImageRuleDialogs 由调用方放在下拉菜单之外；行尾按钮必须在 pointerdown / pointerup / click 上
 * 截断冒泡，否则点一次编辑会连带翻转该行的芯片，这层拦截统一收在 RuleRowAction 里；
 * 表单按原条目区分新建与编辑，换 key 重挂载回到初值。
 */
import { cn } from 'cn'
import { FolderOpen, PencilRuler, Plus, SquarePen, SquareText, Trash2 } from 'lucide-react'
import {
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { PromptRule } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { RuleFormState } from '../hooks/useRuleMenu'
import type { JSX, KeyboardEvent, ReactNode, SyntheticEvent } from 'react'

interface ImageRuleMenuProps {
    /** 已列举的规则：排序与归属由调用方决定 */
    rules: readonly PromptRule[]
    isLoading: boolean
    /** 已挂规则的标识：列表据此回显挂载态 */
    selectedRules: readonly string[]
    /** 点选规则：由输入卡片切换对应芯片 */
    onToggle: (rule: PromptRule) => void
    onEdit: (rule: PromptRule) => void
    onDelete: (rule: PromptRule) => void
    onCreate: () => void
    onOpenDir: () => void
}

interface ImageRuleDialogsProps {
    form: RuleFormState | null
    /** 待删除的规则：null 表示删除确认关闭 */
    pendingDelete: PromptRule | null
    /** 规则目录的本地路径：写进新建说明，让用户知道 md 落在哪里 */
    dirPath: string
    isSaving: boolean
    /** 表单关闭：由调用方清空编辑目标 */
    onFormClose: () => void
    onFormSubmit: (name: string, content: string) => void
    /** 删除确认关闭：由调用方清空待删项 */
    onDeleteClose: () => void
    onConfirmDelete: () => void
}

/**
 * 行尾操作按钮的事件拦截：Radix 在整行的 pointerdown / pointerup / click 三处都可能派发选中，
 * 任意一处漏掉，点一次「编辑」都会顺带把这条规则挂上或摘掉。
 */
function stopRowSelect(event: SyntheticEvent): void {
    event.stopPropagation()
}

/** 按键只在激活键上截断：Escape 仍要冒泡出去关菜单 */
function stopRowKeySelect(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation()
    }
}

/** 弹窗只在关闭时需要清空待处理项：把「是否关闭」的判断收在一处，两个弹窗共用 */
function whenClosed(onClose: () => void): (isOpen: boolean) => void {
    return (isOpen: boolean) => {
        if (!isOpen) {
            onClose()
        }
    }
}

interface RuleRowActionProps {
    /** 可访问名：行内只有图标，屏幕阅读器靠它区分动作与目标规则 */
    label: string
    /** 删除等不可逆操作为 true，图标取 destructive 色 */
    isDestructive?: boolean
    onAction: () => void
    children: ReactNode
}

/** 行尾图标按钮：自带整行选中的拦截，编辑与删除只差图标、配色与回调 */
function RuleRowAction({ label, isDestructive = false, onAction, children }: RuleRowActionProps): JSX.Element {
    return (
        <Button
            size="icon-xs"
            variant="ghost"
            className={cn(isDestructive && 'text-destructive')}
            aria-label={label}
            onPointerDown={stopRowSelect}
            onPointerUp={stopRowSelect}
            onKeyDown={stopRowKeySelect}
            onClick={(event) => {
                event.stopPropagation()
                onAction()
            }}
        >
            {children}
        </Button>
    )
}

interface RuleRowProps {
    rule: PromptRule
    /** 该规则是否已挂成芯片 */
    isSelected: boolean
    onToggle: (rule: PromptRule) => void
    onEdit: (rule: PromptRule) => void
    onDelete: (rule: PromptRule) => void
}

/** 规则行：图标 + 名称即整行开关，行尾两个按钮负责编辑与删除 */
function RuleRow({ rule, isSelected, onToggle, onEdit, onDelete }: RuleRowProps): JSX.Element {
    return (
        <DropdownMenuItem
            className={cn('pr-1', isSelected ? 'text-foreground' : 'text-muted-foreground')}
            onSelect={() => onToggle(rule)}
        >
            <SquareText />
            <span className="flex-1 truncate">{rule.name}</span>
            <div className="flex items-center gap-0.5">
                <RuleRowAction label={`编辑${rule.name}`} onAction={() => onEdit(rule)}>
                    <SquarePen />
                </RuleRowAction>
                <RuleRowAction label={`删除${rule.name}`} isDestructive onAction={() => onDelete(rule)}>
                    <Trash2 />
                </RuleRowAction>
            </div>
        </DropdownMenuItem>
    )
}

/** 表单说明：编辑讲清改名的影响，新建报出落盘目录 */
function ruleFormDescription(isEditing: boolean, dirPath: string): string {
    if (isEditing) {
        return '保存后整段替换原 md；改名等于换一个芯片标识，已挂的芯片会跟着改'
    }
    return dirPath.length > 0
        ? `以 md 文件保存到 ${dirPath}，勾选后作为上下文并入提示词`
        : '以 md 文件保存到存储根的 prompt/rules 目录，勾选后作为上下文并入提示词'
}

interface RuleFormDialogProps {
    /** 表单状态：null 表示关闭，original 为 null 表示新建 */
    form: RuleFormState | null
    dirPath: string
    isSaving: boolean
    onOpenChange: (isOpen: boolean) => void
    onSubmit: (name: string, content: string) => void
}

/** 规则表单：新建与编辑共用，标题、说明与初值由表单状态决定 */
function RuleFormDialog({ form, dirPath, isSaving, onOpenChange, onSubmit }: RuleFormDialogProps): JSX.Element {
    const original = form?.original ?? null
    const isEditing = original !== null
    const name = useTrimmedInput(original?.name ?? '')
    const content = useTrimmedInput(original?.content ?? '')
    const isSubmitDisabled = name.isBlank || content.isBlank

    const handleSubmit = (): void => {
        if (isSubmitDisabled) {
            return
        }
        onSubmit(name.trimmedValue, content.trimmedValue)
    }

    return (
        <FormDialog
            open={form !== null}
            title={isEditing ? '编辑规则' : '新建规则'}
            description={ruleFormDescription(isEditing, dirPath)}
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

/** 规则子菜单：列表 + 新建入口 + 打开目录，必须渲染在下拉菜单内 */
export function ImageRuleMenu({
    rules,
    isLoading,
    selectedRules,
    onToggle,
    onEdit,
    onDelete,
    onCreate,
    onOpenDir,
}: ImageRuleMenuProps): JSX.Element {
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <PencilRuler />
                <span className="flex-1">规则</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
                {rules.length > 0 ? (
                    /* 滚动交给内层：外层不滚动，毛玻璃底色与描边才不会随内容滚出可视区 */
                    <div className="max-h-64 overflow-x-hidden overflow-y-auto">
                        {rules.map((rule) => (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                isSelected={selectedRules.includes(rule.id)}
                                onToggle={onToggle}
                                onEdit={onEdit}
                                onDelete={onDelete}
                            />
                        ))}
                    </div>
                ) : (
                    <DropdownMenuItem disabled>{isLoading ? '读取中…' : '暂无规则'}</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onCreate}>
                    <Plus />
                    新建规则…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenDir}>
                    <FolderOpen />
                    打开规则目录
                </DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    )
}

/** 规则表单与删除确认：由调用方放在下拉菜单之外，避免菜单收起时被一起卸载 */
export function ImageRuleDialogs({
    form,
    pendingDelete,
    dirPath,
    isSaving,
    onFormClose,
    onFormSubmit,
    onDeleteClose,
    onConfirmDelete,
}: ImageRuleDialogsProps): JSX.Element {
    return (
        <>
            {/* 每次打开换 key 重挂载，字段自然回到新建空值或该条正文，不必在子组件里手写重置 */}
            <RuleFormDialog
                key={form === null ? 'rule-form-closed' : `rule-form-${form.original?.name ?? 'new'}`}
                form={form}
                dirPath={dirPath}
                isSaving={isSaving}
                onOpenChange={whenClosed(onFormClose)}
                onSubmit={onFormSubmit}
            />
            <ConfirmDialog
                open={pendingDelete !== null}
                title={pendingDelete === null ? '删除规则' : `删除规则「${pendingDelete.name}」？`}
                description="md 文件会移入系统回收站，已挂的芯片同时摘除。"
                confirmLabel="删除"
                size="sm"
                isDestructive
                isSubmitting={isSaving}
                onOpenChange={whenClosed(onDeleteClose)}
                onConfirm={onConfirmDelete}
            />
        </>
    )
}
