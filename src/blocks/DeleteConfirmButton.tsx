/**
 * 删除操作按钮：图标按钮 + 二次确认弹窗的固定搭配，确认后才执行回调。
 * 复用约定：按钮取 @webview/components/Button，弹窗取 @webview/components/AlertDialog，图标取 lucide 的 Trash2；
 * 条目内的删除入口都走这里，文案由调用方给；tooltip 兼作无障碍名称，图标按钮没有可见文字，二者不可分家。
 * 关键约束：确认时先关弹窗再执行——弹窗滞留旧数据会让用户以为没删掉；
 * 条目本身可点击时必须传 isStopPropagation，否则点删除会连带触发父级的打开动作；
 * 按钮在条目未悬停时半透明，靠父级的 group/item 命名组提亮，容器须带同名 group 类。
 * size / variant / className 可覆盖默认的图标按钮外观，类名走 cn 合并、冲突以传入为准，图标尺寸随 size 分流；
 * variant 默认 destructive 淡红底，原入口是 ghost 图标时传 ghost 并自加 hover:text-destructive；
 * confirmLabel 默认「删除」，彻底删除等语义不同的场景可显式指定；
 * 其余按钮属性经 props 透传但展开在受控属性之前，尺寸、类名、提示与点击逻辑不被调用方覆盖。
 */
'use client'

import { cn } from 'cn'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AlertDialog } from '@webview/components/AlertDialog'
import { Button, type ButtonProps } from '@webview/components/Button'
import type { JSX } from 'react'

/**
 * 可透传给底层按钮的属性：剔除本组件自己把控的尺寸、类名、点击、提示与无障碍名称，
 * 避免同一属性两处来源互相覆盖。
 */
type PassThroughButtonProps = Omit<
    ButtonProps,
    'variant' | 'size' | 'className' | 'onClick' | 'aria-label' | 'tooltip' | 'children'
>

export interface DeleteConfirmButtonProps {
    /** 悬停提示文案，同时用作无障碍名称：如「删除标注」「删除 AI 解释」 */
    tooltip: string
    /** 确认弹窗标题：一句话说明删的是什么 */
    title: string
    /** 确认弹窗说明：写清后果，不可逆操作必须提示 */
    description: string
    /** 确认后执行：请求与失败提示由调用方负责 */
    onConfirm: () => void
    /** 条目本身可点击时置真：阻止冒泡，避免连带打开详情 */
    isStopPropagation?: boolean
    /** 按钮尺寸：默认 icon 为 32×32，需要更紧凑的 24×24 小格子时传 icon-xs */
    size?: ButtonProps['size']
    /** 按钮变体：默认 destructive 淡红底，原入口是 ghost 图标时传 ghost 并自加 hover:text-destructive */
    variant?: ButtonProps['variant']
    /** 确认按钮文案：默认「删除」，彻底删除、删除人物等语义不同时显式指定 */
    confirmLabel?: string
    /** 按钮附加类名：与默认的半透明 / 悬停提亮类合并，冲突时以传入为准 */
    className?: string
    /** 按钮其余属性：整体透传给底层 Button，如 disabled、title */
    props?: PassThroughButtonProps
}

export function DeleteConfirmButton({
    tooltip,
    title,
    description,
    onConfirm,
    isStopPropagation = false,
    size = 'icon',
    variant = 'destructive',
    confirmLabel = '删除',
    className,
    props,
}: DeleteConfirmButtonProps): JSX.Element {
    const [isConfirmOpen, setIsConfirmOpen] = useState(false)
    // 图标尺寸随按钮分流：icon-xs 是 24×24 的小格子配 14px 图标，其余尺寸配 16px，避免大按钮挂小图标
    const isCompactIcon = size === 'icon-xs'

    return (
        <>
            <Button
                {...props}
                variant={variant}
                size={size}
                className={cn('opacity-50 group-hover/item:opacity-100 focus-visible:opacity-100', className)}
                tooltip={tooltip}
                aria-label={tooltip}
                onClick={(event): void => {
                    if (isStopPropagation) {
                        event.stopPropagation()
                    }
                    setIsConfirmOpen(true)
                }}
            >
                <Trash2 className={isCompactIcon ? 'size-3.5' : 'size-4'} />
            </Button>
            <AlertDialog
                open={isConfirmOpen}
                title={title}
                description={description}
                confirmLabel={confirmLabel}
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
