/**
 * 词条弹窗：新建/编辑表单与删除确认，挂在面板浮层之外，避免浮层收起时被连带卸载。
 * 复用约定：表单取 @webview/components/FormDialog，确认取 @webview/components/ConfirmDialog，
 * 文本状态取 @webview/hooks/useTrimmedInput，已有分类与分组从 props 传入做快捷填充。
 * 关键约束：分类名会成为 md 文件名，因此不接受空值与路径分隔符，真正的校验与拒绝由宿主兜底；
 * 编辑时改名等于换芯片标识，说明里必须讲清影响；每次打开换 key 重挂载，字段自然回到初值。
 */
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { PromptTag, PromptTagObject, PromptTagSaveRequest } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { TagFormState } from '../hooks/usePromptLibrary'
import type { JSX } from 'react'
import { attributesOf } from '../prompt/promptLibrary'

/** 关闭浮层时回调：Dialog 只在关闭时通知调用方清状态 */
function whenClosed(close: () => void): (isOpen: boolean) => void {
    return (isOpen) => {
        if (!isOpen) {
            close()
        }
    }
}

/** 表单说明：编辑讲清改名的影响，新建报出落盘目录 */
function tagFormDescription(isEditing: boolean, dirPath: string): string {
    if (isEditing) {
        return '保存后整块替换原 md；改分类、分组或名称等于换芯片标识，已挂的芯片会跟着改'
    }
    return dirPath.length > 0
        ? `以 md 保存到 ${dirPath}，文件名即分类名，同一分组内不允许重名`
        : '以 md 保存到存储根的 prompt/tags 目录，文件名即分类名，同一分组内不允许重名'
}

interface TagFormDialogProps {
    /** 表单状态：null 表示关闭，original 为 null 表示新建 */
    form: TagFormState | null
    dirPath: string
    /** 已有分类：点一下即可填入，避免手打错字建出新文件 */
    objects: readonly PromptTagObject[]
    isSaving: boolean
    onOpenChange: (isOpen: boolean) => void
    onSubmit: (input: PromptTagSaveRequest) => void
}

/** 词条表单：分类、分组、名称与原文四段，分类与分组提供已有值快捷填充 */
function TagFormDialog({ form, dirPath, objects, isSaving, onOpenChange, onSubmit }: TagFormDialogProps): JSX.Element {
    const original: PromptTag | null = form?.original ?? null
    const isEditing = original !== null
    const object = useTrimmedInput(original?.object ?? '')
    const attribute = useTrimmedInput(original?.attribute ?? '')
    const name = useTrimmedInput(original?.name ?? '')
    const prompt = useTrimmedInput(original?.prompt ?? '')
    const knownAttributes = attributesOf(objects, object.trimmedValue)
    const isSubmitDisabled = object.isBlank || attribute.isBlank || name.isBlank || prompt.isBlank

    const handleSubmit = (): void => {
        if (isSubmitDisabled) {
            return
        }
        onSubmit({
            object: object.trimmedValue,
            attribute: attribute.trimmedValue,
            name: name.trimmedValue,
            prompt: prompt.trimmedValue,
        })
    }

    return (
        <FormDialog
            open={form !== null}
            title={isEditing ? '编辑词条' : '新建词条'}
            description={tagFormDescription(isEditing, dirPath)}
            submitLabel="保存"
            isSubmitting={isSaving}
            isSubmitDisabled={isSubmitDisabled}
            contentClassName="sm:max-w-md"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="image-tag-object">分类</FieldLabel>
                <Input
                    id="image-tag-object"
                    value={object.value}
                    placeholder="如：人物，会作为 md 文件名"
                    onChange={(event) => object.setValue(event.target.value)}
                />
                {objects.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                        {objects.map((item) => (
                            <Button
                                key={item.name}
                                size="sm"
                                variant={object.trimmedValue === item.name ? 'secondary' : 'ghost'}
                                className="h-6 px-2 text-xs"
                                onClick={() => object.setValue(item.name)}
                            >
                                {item.name}
                            </Button>
                        ))}
                    </div>
                ) : null}
            </Field>
            <Field>
                <FieldLabel htmlFor="image-tag-attribute">分组</FieldLabel>
                <Input
                    id="image-tag-attribute"
                    value={attribute.value}
                    placeholder="如：基础"
                    onChange={(event) => attribute.setValue(event.target.value)}
                />
                {knownAttributes.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                        {knownAttributes.map((item) => (
                            <Button
                                key={item.name}
                                size="sm"
                                variant={attribute.trimmedValue === item.name ? 'secondary' : 'ghost'}
                                className="h-6 px-2 text-xs"
                                onClick={() => attribute.setValue(item.name)}
                            >
                                {item.name}
                            </Button>
                        ))}
                    </div>
                ) : null}
            </Field>
            <Field>
                <FieldLabel htmlFor="image-tag-name">词条名</FieldLabel>
                <Input
                    id="image-tag-name"
                    value={name.value}
                    placeholder="如：小女孩，芯片上显示这个名字"
                    onChange={(event) => name.setValue(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="image-tag-prompt">提示词原文</FieldLabel>
                <Textarea
                    id="image-tag-prompt"
                    value={prompt.value}
                    placeholder="如：little_girl，发送时按芯片顺序并入提示词"
                    className="min-h-24 text-sm leading-5"
                    onChange={(event) => prompt.setValue(event.target.value)}
                />
            </Field>
        </FormDialog>
    )
}

interface ImagePromptTagDialogsProps {
    /** 表单状态：null 表示关闭，original 为 null 表示新建 */
    form: TagFormState | null
    /** 待删除词条：null 表示关闭 */
    pendingDelete: PromptTag | null
    dirPath: string
    objects: readonly PromptTagObject[]
    isSaving: boolean
    onFormClose: () => void
    onFormSubmit: (input: PromptTagSaveRequest) => void
    onDeleteClose: () => void
    onConfirmDelete: () => void
}

/** 词条弹窗集合：由面板放在浮层之外渲染，浮层收起不会把它一起卸载 */
export function ImagePromptTagDialogs({
    form,
    pendingDelete,
    dirPath,
    objects,
    isSaving,
    onFormClose,
    onFormSubmit,
    onDeleteClose,
    onConfirmDelete,
}: ImagePromptTagDialogsProps): JSX.Element {
    return (
        <>
            {/* 每次打开换 key 重挂载，字段自然回到新建空值或该条内容，不必在子组件里手写重置 */}
            <TagFormDialog
                key={form === null ? 'tag-form-closed' : `tag-form-${form.original?.id ?? 'new'}`}
                form={form}
                dirPath={dirPath}
                objects={objects}
                isSaving={isSaving}
                onOpenChange={whenClosed(onFormClose)}
                onSubmit={onFormSubmit}
            />
            <ConfirmDialog
                open={pendingDelete !== null}
                title={pendingDelete === null ? '删除词条' : `删除词条「${pendingDelete.name}」？`}
                description="对应内容会从 md 中移除；分类删空时该 md 一并删除，已挂的芯片同时摘除。"
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
