/**
 * Unsplash 密钥弹窗：填写 Access Key，保存后由宿主立即用一次真实请求验证。
 * 复用约定：骨架取 @webview/components/FormDialog，字段取 @components/ui 的 field 与 textarea，
 * 输入状态取 useTrimmedInput；密钥只写系统级加密存储，界面只回显尾号。
 * 关键约束：粘贴的是整段密钥，用多行输入框承载便于核对；输入期间明文可读，文案里必须提醒；
 * 已有密钥时留空表示沿用（本弹窗不做「改一半」的写入），清理由页面单独提供；
 * 校验未通过时弹窗不关闭，由页面的 onSubmit 返回 false 决定。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Textarea } from '@components/ui/textarea'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

interface StockKeyDialogProps {
    open: boolean
    /** 已存密钥的尾号提示：null 表示还没配置过 */
    secretHint: string | null
    onOpenChange: (isOpen: boolean) => void
    /** 返回是否保存成功：false 时保持弹窗打开 */
    onSubmit: (accessKey: string) => Promise<boolean>
}

export function StockKeyDialog({ open, secretHint, onOpenChange, onSubmit }: StockKeyDialogProps): JSX.Element {
    const accessKey = useTrimmedInput('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    async function handleSubmit(): Promise<void> {
        if (accessKey.isBlank) {
            return
        }
        setIsSubmitting(true)
        try {
            const isSaved = await onSubmit(accessKey.trimmedValue)
            if (isSaved) {
                accessKey.reset()
                onOpenChange(false)
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <FormDialog
            open={open}
            title="Unsplash Access Key"
            description="在 unsplash.com/oauth/applications 创建应用后复制 Access Key。保存时会立即验证一次。"
            submitLabel="保存并验证"
            isSubmitting={isSubmitting}
            isSubmitDisabled={accessKey.isBlank}
            contentClassName="sm:max-w-md"
            onOpenChange={onOpenChange}
            onSubmit={() => {
                void handleSubmit()
            }}
        >
            <Field>
                <FieldLabel htmlFor="stock-access-key">Access Key</FieldLabel>
                <Textarea
                    id="stock-access-key"
                    value={accessKey.value}
                    rows={3}
                    placeholder={secretHint === null ? '粘贴 Access Key' : `当前已配置 ${secretHint}，粘贴新密钥可覆盖`}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                    onChange={(event) => accessKey.setValue(event.target.value)}
                />
                <FieldDescription>
                    密钥只写入系统级加密存储，界面只显示尾号；Demo 应用每小时 50 次调用，个人使用足够。
                </FieldDescription>
            </Field>
        </FormDialog>
    )
}
