/**
 * 新建批次弹窗：只收集批次标题，留空由宿主生成「未命名批次 · 月-日」。
 * 复用约定：骨架取 FormDialog，输入取 @components/ui/input，文本框状态取 useTrimmedInput；
 * 标题长度上限与展示口径取 shared/types/wechat。
 * 关键约束：标题可为空，因此提交按钮始终可用——空标题不是错误，宿主会补默认值；
 * 表单重置由页面在每次打开时更换组件 key 完成，本组件不在 effect 中写状态。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { WECHAT_ISSUE_TITLE_MAX } from '@shared/types/wechat'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

interface WechatIssueCreateDialogProps {
    open: boolean
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (title: string) => Promise<boolean>
}

export function WechatIssueCreateDialog({
    open,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: WechatIssueCreateDialogProps): JSX.Element {
    const title = useTrimmedInput()

    const handleSubmit = (): void => {
        void onSubmit(title.value)
    }

    return (
        <FormDialog
            open={open}
            title="新建推送批次"
            description="一次群发对应一个批次，批次内最多 8 篇文章。"
            submitLabel="创建"
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-issue-title">批次标题</FieldLabel>
                <Input
                    id="wechat-issue-title"
                    value={title.value}
                    maxLength={WECHAT_ISSUE_TITLE_MAX}
                    placeholder="留空则按日期命名"
                    disabled={isSubmitting}
                    onChange={(event) => title.setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            handleSubmit()
                        }
                    }}
                />
                <FieldDescription>标题只用于本地分辨批次，推送时以批次内首篇文章标题为准。</FieldDescription>
            </Field>
        </FormDialog>
    )
}
