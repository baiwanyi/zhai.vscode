/**
 * 标签编辑弹窗：新建/重命名表单与删除确认，关联状态由组件内部持有。
 * 复用约定：表单取 Dialog，破坏性确认取 AlertDialog，输入用 ui/input，名称上限复用共享常量；
 * 对外通过 ref prop 暴露 openForCreate / openForRename / requestRemove 三个命令，写操作由页面回调执行。
 * 关键约束：只有平台写成功后才关闭弹窗；名称 trimmed 后为空不提交；删除确认写明不可撤销的影响；
 * 写操作期间全部控件禁用，避免重复提交；ref 命令用 useImperativeHandle 收敛，父层不感知内部草稿状态；
 * 异步回包先判挂载再关闭弹窗，避免切页后幽灵回写。
 */
import { useImperativeHandle, useState } from 'react'
import { Input } from '@components/ui/input'
import type { WechatFanTag } from '@shared/types/wechat'
import { WECHAT_FAN_TAG_NAME_MAX } from '@shared/types/wechat'
import { AlertDialog } from '@webview/components/AlertDialog'
import { Dialog } from '@webview/components/Dialog'
import { useIsMounted } from '@webview/hooks/useIsMounted'
import type { JSX, Ref } from 'react'

/** 父层可调用的标签编辑命令 */
export interface WechatTagEditorHandle {
    openForCreate: () => void
    openForRename: (tag: WechatFanTag) => void
    requestRemove: (tag: WechatFanTag) => void
}

interface WechatTagEditDialogProps {
    ref: Ref<WechatTagEditorHandle>
    isMutating: boolean
    onCreate: (name: string) => Promise<boolean>
    onRename: (id: number, name: string) => Promise<boolean>
    onRemove: (id: number) => Promise<boolean>
}

export function WechatTagEditDialog({
    ref,
    isMutating,
    onCreate,
    onRename,
    onRemove,
}: WechatTagEditDialogProps): JSX.Element {
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [renamingTag, setRenamingTag] = useState<WechatFanTag | null>(null)
    const [draft, setDraft] = useState('')
    const [pendingRemove, setPendingRemove] = useState<WechatFanTag | null>(null)
    const isMountedRef = useIsMounted()

    useImperativeHandle(
        ref,
        (): WechatTagEditorHandle => ({
            openForCreate: (): void => {
                setRenamingTag(null)
                setDraft('')
                setIsFormOpen(true)
            },
            openForRename: (tag: WechatFanTag): void => {
                setRenamingTag(tag)
                setDraft(tag.name)
                setIsFormOpen(true)
            },
            requestRemove: (tag: WechatFanTag): void => {
                setPendingRemove(tag)
            },
        }),
        [],
    )

    const handleSubmit = async (): Promise<void> => {
        const name = draft.trim()
        if (name.length === 0) {
            return
        }
        const isSaved = renamingTag === null ? await onCreate(name) : await onRename(renamingTag.id, name)
        if (isSaved && isMountedRef.current) {
            setIsFormOpen(false)
        }
    }

    const handleRemove = async (): Promise<void> => {
        if (pendingRemove === null) {
            return
        }
        const isRemoved = await onRemove(pendingRemove.id)
        if (isRemoved && isMountedRef.current) {
            setPendingRemove(null)
        }
    }

    return (
        <>
            <Dialog
                open={isFormOpen}
                title={renamingTag === null ? '新建标签' : '重命名标签'}
                description="1~30 个字符，保存后写入公众号。"
                confirmLabel={renamingTag === null ? '创建' : '保存'}
                isLoading={isMutating}
                isDisabled={draft.trim().length === 0}
                onOpenChange={setIsFormOpen}
                onConfirm={() => void handleSubmit()}
            >
                <Input
                    value={draft}
                    maxLength={WECHAT_FAN_TAG_NAME_MAX}
                    placeholder="标签名称"
                    onChange={(event) => setDraft(event.target.value)}
                />
            </Dialog>
            <AlertDialog
                open={pendingRemove !== null}
                title="删除标签"
                description={
                    pendingRemove === null
                        ? ''
                        : `删除「${pendingRemove.name}」后，其用户将失去该标签，且不可撤销。`
                }
                confirmLabel="删除标签"
                isDestructive
                isSubmitting={isMutating}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingRemove(null)
                    }
                }}
                onConfirm={() => void handleRemove()}
            />
        </>
    )
}
