/**
 * 删除操作按钮：图标按钮 + 二次确认弹窗的固定搭配，确认后才执行回调。
 * 复用约定：按钮取 ./Button，弹窗取 ./ConfirmDialog，图标取 lucide 的 Trash2；
 * 条目内的删除入口都走这里，文案由调用方给，不再各自拼一套按钮与弹窗。
 * 关键约束：确认时先关弹窗再执行——弹窗滞留旧数据会让用户以为没删掉；
 * 条目本身可点击时必须传 isStopPropagation，否则点删除会连带触发父级的打开动作；
 * 按钮在条目未悬停时半透明，靠父级的 group/item 命名组提亮，容器须带同名 group 类。
 */
'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import type { JSX } from 'react'

export interface DeleteConfirmButtonProps {
    /** 按钮的无障碍名称：如「删除标注」「删除 AI 解释」 */
    buttonLabel: string
    /** 确认弹窗标题：一句话说明删的是什么 */
    title: string
    /** 确认弹窗说明：写清后果，不可逆操作必须提示 */
    description: string
    /** 确认后执行：请求与失败提示由调用方负责 */
    onConfirm: () => void
    /** 条目本身可点击时置真：阻止冒泡，避免连带打开详情 */
    isStopPropagation?: boolean
}

export function DeleteConfirmButton({
    buttonLabel,
    title,
    description,
    onConfirm,
    isStopPropagation = false,
}: DeleteConfirmButtonProps): JSX.Element {
    const [isConfirmOpen, setIsConfirmOpen] = useState(false)

    return (
        <>
            <Button
                variant="destructive"
                size="icon-xs"
                className="opacity-50 group-hover/item:opacity-100 focus-visible:opacity-100"
                aria-label={buttonLabel}
                onClick={(event): void => {
                    if (isStopPropagation) {
                        event.stopPropagation()
                    }
                    setIsConfirmOpen(true)
                }}
            >
                <Trash2 className="size-3.5" />
            </Button>
            <ConfirmDialog
                open={isConfirmOpen}
                title={title}
                description={description}
                confirmLabel="删除"
                isDestructive
                onOpenChange={setIsConfirmOpen}
                onConfirm={(): void => {
                    setIsConfirmOpen(false)
                    onConfirm()
                }}
            />
        </>
    )
}
