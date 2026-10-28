/**
 * 重命名清单弹窗：只收集清单的可读名，文件名与文件内一级标题由宿主一并改写。
 * 复用约定：骨架取业务公共层的 FormDialog，文本状态与 trim 判定取 useTrimmedInput；
 * 提交失败时保持打开便于就地修改（由 onSubmit 的布尔结果决定）。
 * 关键约束：初始名由父级以组件 key 切换实现重置，本组件不在 effect 中同步写状态；
 * 空名与「名字没改」一律不允许提交——宿主把同名当成重名直接拒绝，提前拦下可免掉一次无意义的失败提示；
 * 长度上限与宿主 normalizeListId 保持同一口径；Enter 提交须跳过输入法组合态，
 * 否则中文选词时按回车会误触提交；保留字符与重名仍由宿主侧再校验。
 */
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

/** 清单名长度上限：与宿主 normalizeListId 的校验保持一致，超长会在提交时被拒 */
const MAX_NAME_LENGTH = 60

export interface TodoListRenameDialogProps {
    open: boolean
    /** 当前清单名，作为输入框初始值 */
    initialName: string
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string) => Promise<boolean>
}

export function TodoListRenameDialog({
    open,
    initialName,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: TodoListRenameDialogProps): JSX.Element {
    const name = useTrimmedInput(initialName)
    /** 名字没变：宿主按重名拒绝，这里提前算好，供按钮禁用与 Enter 提交共用同一判定 */
    const isUnchanged = name.trimmedValue === initialName.trim()
    const isSubmitDisabled = name.isBlank || isUnchanged

    const handleSubmit = async (): Promise<void> => {
        if (isSubmitDisabled || isSubmitting) {
            return
        }
        const isSucceeded = await onSubmit(name.trimmedValue)
        if (isSucceeded) {
            onOpenChange(false)
        }
    }

    return (
        <FormDialog
            open={open}
            title="重命名清单"
            description="仅修改清单名称，文件位置与其中的待办保持不变。"
            submitLabel="保存"
            isSubmitting={isSubmitting}
            isSubmitDisabled={isSubmitDisabled}
            onOpenChange={onOpenChange}
            onSubmit={() => void handleSubmit()}
        >
            <Field>
                <FieldLabel htmlFor="todo-list-name">清单名</FieldLabel>
                <Input
                    id="todo-list-name"
                    value={name.value}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="例如：本周待办"
                    disabled={isSubmitting}
                    onChange={(event) => name.setValue(event.target.value)}
                    onKeyDown={(event) => {
                        // Enter 提交由弹窗接管；输入法组合中的回车交给输入法确认候选词
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            void handleSubmit()
                        }
                    }}
                />
            </Field>
        </FormDialog>
    )
}
