/**
 * 设置备注弹窗：给关注的人起一个只在本机看到的备注名。
 * 复用约定：骨架取 @webview/components/FormDialog，输入取 @components/ui/input 与 field 槽位，
 * trim 走 hooks/useTrimmedInput，保存走 hooks/useWeiboUserRemark（协议 weibo/user/remark）。
 * 关键约束：备注 1-15 字，留空保存等于清除备注；保存中禁用提交；
 * 初值来自主页资料，保存成功后以宿主回包的 remark 回写，不在关闭时丢弃；
 * 打开即定位到输入框末尾，避免接手旧文本时还要手动移到结尾。
 */
import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'
import { useWeiboUserRemark } from '../hooks/useWeiboUserRemark'

/** 备注长度上限：网页端 1-15 字 */
const REMARK_MAX = 15

export interface UserRemarkDialogProps {
    uid: string
    /** 用户昵称：只用于标题，备注不替代昵称展示 */
    userName: string
    /** 已保存的备注：作为输入初值 */
    initialRemark: string
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 保存成功：页面可据此回写资料里的备注 */
    onSaved: (remark: string) => void
}

export function UserRemarkDialog({
    uid,
    userName,
    initialRemark,
    isOpen,
    onOpenChange,
    onSaved,
}: UserRemarkDialogProps): JSX.Element {
    const { remark, isSaving, save } = useWeiboUserRemark(uid, initialRemark)
    const { value, trimmedValue, setValue } = useTrimmedInput(remark)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const isTooLong = [...trimmedValue].length > REMARK_MAX

    /**
     * 打开时把光标放到末尾：备注通常是「在原名后补充」而不是整段重写；
     * 关闭时把输入恢复成已保存值，避免下次打开看到上次没提交的草稿。
     */
    const handleOpenChange = useCallback(
        (next: boolean): void => {
            if (next) {
                requestAnimationFrame(() => {
                    const node = inputRef.current
                    if (node !== null) {
                        node.focus()
                        node.setSelectionRange(node.value.length, node.value.length)
                    }
                })
            } else {
                setValue(remark)
            }
            onOpenChange(next)
        },
        [onOpenChange, remark, setValue],
    )

    const handleSubmit = useCallback((): void => {
        void save(trimmedValue).then((isSaved) => {
            if (!isSaved) {
                return
            }
            onOpenChange(false)
            onSaved(trimmedValue)
            toast.success(trimmedValue.length === 0 ? '已清除备注' : '备注已保存')
        })
    }, [onOpenChange, onSaved, save, trimmedValue])

    return (
        <FormDialog
            open={isOpen}
            title={`设置备注 · ${userName}`}
            description="备注只影响本机显示，不会改变对方的昵称。"
            submitLabel="保存备注"
            isSubmitting={isSaving}
            isSubmitDisabled={isTooLong}
            contentClassName="sm:max-w-md"
            onOpenChange={handleOpenChange}
            onSubmit={handleSubmit}
        >
            <FieldGroup>
                <Field data-invalid={isTooLong}>
                    <FieldLabel htmlFor="weibo-user-remark">备注名</FieldLabel>
                    <Input
                        id="weibo-user-remark"
                        ref={inputRef}
                        value={value}
                        maxLength={REMARK_MAX}
                        placeholder={`最多 ${String(REMARK_MAX)} 字，留空即清除`}
                        disabled={isSaving}
                        onChange={(event) => {
                            setValue(event.target.value)
                        }}
                    />
                    <FieldDescription className="text-xs">
                        {`按字计 ${String(REMARK_MAX)} 字以内；留空保存即清除备注。`}
                    </FieldDescription>
                    {isTooLong ? <FieldError className="text-xs">备注不能超过 15 字</FieldError> : null}
                </Field>
            </FieldGroup>
        </FormDialog>
    )
}
