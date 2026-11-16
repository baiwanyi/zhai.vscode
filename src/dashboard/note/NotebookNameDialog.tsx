/**
 * 笔记本名称弹窗：新建与重命名共用一套输入、校验与提交逻辑，仅文案与禁用条件按模式切换。
 * 复用约定：骨架取业务公共层的 FormDialog，文本状态与 trim 判定取 useTrimmedInput。
 * 关键约束：空名一律不允许提交；重命名模式额外拦下「名字没改」——宿主对同名会静默返回原名、不做任何改名，
 * 提前拦下省掉一次无意义请求；仅大小写不同时宿主按同名处理（列表不会变），前端按精确值比较后放行，不做额外拦截；
 * 初始名由父级以组件 key 切换实现重置，本组件不在 effect 中同步写状态；
 * Enter 提交须跳过输入法组合态，否则中文选词时按回车会误触提交；长度上限与宿主归一化口径一致。
 */
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

/** 笔记本名长度上限：与宿主 notebookService 的 MAX_NOTEBOOK_NAME_LENGTH 同值，两处各自硬编码，调整需同步 */
const MAX_NAME_LENGTH = 60

export interface NotebookNameDialogProps {
    open: boolean
    /** 决定文案与校验：新建只看空值，重命名还要拦下未改名 */
    mode: 'create' | 'rename'
    /** 重命名时的当前名称，作为输入框初始值；新建时省略 */
    initialName?: string
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string) => Promise<boolean>
}

export function NotebookNameDialog({
    open,
    mode,
    initialName,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: NotebookNameDialogProps): JSX.Element {
    const isRename = mode === 'rename'
    const name = useTrimmedInput(initialName ?? '')
    /** 名字没变：宿主按重名拒绝，这里提前算好，供按钮禁用与 Enter 提交共用同一判定 */
    const isUnchanged = isRename && name.trimmedValue === (initialName ?? '').trim()
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
            title={isRename ? '重命名笔记本' : '新建笔记本'}
            description={
                isRename
                    ? '仅修改目录名，笔记本内的笔记与置顶状态保持不变。'
                    : '笔记本对应 notes/ 下的一个目录，名称可随时修改。'
            }
            submitLabel={isRename ? '保存' : '创建'}
            isSubmitting={isSubmitting}
            isSubmitDisabled={isSubmitDisabled}
            onOpenChange={onOpenChange}
            onSubmit={() => void handleSubmit()}
        >
            <Field>
                <FieldLabel htmlFor="notebook-name">笔记本名</FieldLabel>
                <Input
                    id="notebook-name"
                    value={name.value}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="例如：读书笔记"
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
