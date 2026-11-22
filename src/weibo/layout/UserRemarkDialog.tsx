/**
 * 设置备注弹窗：给关注的人起一个只在本机看到的备注名。
 * 复用约定：骨架取 @webview/components/FormDialog，输入取 @components/ui/input 与 field 槽位，
 * trim 走 hooks/useTrimmedInput，保存走 hooks/useWeiboUserRemark（协议 weibo/user/remark）。
 * 关键约束：备注 1-15 字，留空保存等于清除备注；保存中禁用提交；
 * 初值来自主页资料，保存成功后以宿主回包的 remark 回写，不在关闭时丢弃；
 * 打开即定位到输入框末尾，避免接手旧文本时还要手动移到结尾。
 */
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { WEIBO_REMARK_MAX, isWeiboTimelineId } from '@shared/types/weibo'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'
import { useWeiboUserRemark } from '../hooks/useWeiboUserRemark'

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
    const isTooLong = [...trimmedValue].length > WEIBO_REMARK_MAX

    /**
     * 打开时把光标放到末尾：备注通常是「在原名后补充」而不是整段重写。
     * 关键约束：受控 Dialog 由父级置 open 时不会回调 onOpenChange(true)，聚焦只能挂在 isOpen 上，
     * 且帧回调要在关闭/卸载时取消，避免焦点被抢回已经不可见的输入框。
     */
    useEffect(() => {
        if (!isOpen) {
            return
        }
        const frame = requestAnimationFrame(() => {
            const node = inputRef.current
            if (node === null) {
                return
            }
            node.focus()
            node.setSelectionRange(node.value.length, node.value.length)
        })
        return (): void => {
            cancelAnimationFrame(frame)
        }
    }, [isOpen])

    /** 回包会裁掉首尾空白：备注更新后把输入同步成真实值，下次打开才不会看到带空格的旧文本 */
    useEffect(() => {
        setValue(remark)
    }, [remark, setValue])

    /** 关闭：把输入恢复成已保存值，避免下次打开看到上次没提交的草稿 */
    const handleOpenChange = useCallback(
        (next: boolean): void => {
            if (!next) {
                setValue(remark)
            }
            onOpenChange(next)
        },
        [onOpenChange, remark, setValue],
    )

    const handleSubmit = useCallback((): void => {
        void save(trimmedValue).then((savedRemark) => {
            if (savedRemark === null) {
                return
            }
            // 输入与页面回写都用回包值：上游会裁掉首尾空白，本地草稿不该与真实备注分叉
            setValue(savedRemark)
            onOpenChange(false)
            onSaved(savedRemark)
            toast.success(savedRemark.length === 0 ? '已清除备注' : '备注已保存')
        })
    }, [onOpenChange, onSaved, save, setValue, trimmedValue])

    return (
        <FormDialog
            open={isOpen}
            title={userName.trim().length > 0 ? `设置备注 · ${userName}` : '设置备注'}
            description="备注只影响本机显示，不会改变对方的昵称。"
            submitLabel="保存备注"
            isSubmitting={isSaving}
            isSubmitDisabled={isTooLong || !isWeiboTimelineId(uid)}
            contentClassName="sm:max-w-md"
            onOpenChange={handleOpenChange}
            onSubmit={handleSubmit}
        >
            <FieldGroup>
                <Field data-invalid={isTooLong}>
                    <FieldLabel htmlFor="weibo-user-remark">备注名</FieldLabel>
                    {/* 不再用 maxLength 硬截断：它按 UTF-16 码元算，emoji 会被砍到 7 个，
                        与协议层「按码点 15 字」的口径不一致；超长改由 isTooLong 提示并禁用提交 */}
                    <Input
                        id="weibo-user-remark"
                        ref={inputRef}
                        value={value}
                        aria-invalid={isTooLong}
                        aria-describedby={isTooLong ? 'weibo-user-remark-error' : undefined}
                        placeholder={`最多 ${String(WEIBO_REMARK_MAX)} 字，留空即清除`}
                        disabled={isSaving}
                        onChange={(event) => {
                            setValue(event.target.value)
                        }}
                    />
                    <FieldDescription className="text-xs">
                        {`按字计 ${String(WEIBO_REMARK_MAX)} 字以内；留空保存即清除备注。`}
                    </FieldDescription>
                    {isTooLong ? (
                        <FieldError id="weibo-user-remark-error" className="text-xs">
                            {`备注不能超过 ${String(WEIBO_REMARK_MAX)} 字`}
                        </FieldError>
                    ) : null}
                </Field>
            </FieldGroup>
        </FormDialog>
    )
}
