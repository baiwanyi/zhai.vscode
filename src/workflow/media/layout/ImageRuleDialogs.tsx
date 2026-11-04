/**
 * 生图「规则」配套弹窗：表单承担新建与编辑，确认框承担删除。
 * 复用约定：表单取 @webview/components/FormDialog，删除确认取 @webview/components/ConfirmDialog，
 * 字段取 @components/ui 的 field/input/textarea，文本状态取 @webview/hooks/useTrimmedInput；
 * 表单状态类型取 ../hooks/useRuleMenu 的 RuleFormState，规则类型取 @shared/types/imagegen。
 * 关键约束：弹窗必须渲染在下拉菜单之外——菜单收起会卸载整棵子树；
 * 表单按原条目区分新建与编辑，换 key 重挂载回到初值，关闭时由调用方清空待处理项。
 */
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { PromptRule } from '@shared/types/imagegen'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { RuleFormState } from '../hooks/useRuleMenu'
import type { JSX } from 'react'

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

/** 弹窗只在关闭时需要清空待处理项：把「是否关闭」的判断收在一处，两个弹窗共用 */
function whenClosed(onClose: () => void): (isOpen: boolean) => void {
    return (isOpen: boolean) => {
        if (!isOpen) {
            onClose()
        }
    }
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
