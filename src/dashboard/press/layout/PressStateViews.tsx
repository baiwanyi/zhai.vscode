/**
 * 作品模块共用的状态视图：加载骨架与失败重试块，供作品列表页、作品详情页复用。
 * 复用 @components/ui 的 skeleton 与业务公共层的 StateEmpty；骨架条数与单条尺寸由调用方传入，组件不内置业务数量。
 * 关键约束：骨架以常量下标数组生成 key，不用数组下标直接作 key；失败块的重试按钮统一 outline 形态，保证两处外观一致。
 */
import { cn } from 'cn'
import { Skeleton } from '@components/ui/skeleton'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { JSX } from 'react'

/** 骨架占位 key：最多取前六条，够覆盖列表与章节目录的首屏占位 */
const SKELETON_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const

interface PressSkeletonListProps {
    /** 骨架条数，对应取 SKELETON_KEYS 的前 N 项 */
    count: number
    /** 单条骨架的尺寸与圆角类，如 h-12 rounded-xl */
    itemClassName: string
}

export function PressSkeletonList({ count, itemClassName }: PressSkeletonListProps): JSX.Element {
    return (
        <div className="flex w-full flex-col gap-2">
            {SKELETON_KEYS.slice(0, count).map((key) => (
                <Skeleton key={key} className={cn('w-full', itemClassName)} />
            ))}
        </div>
    )
}

interface PressErrorStateProps {
    title: string
    /** 数据层给出的失败原因，缺省时回落到通用文案 */
    message: string | null
    onRetry: () => void
}

export function PressErrorState({ title, message, onRetry }: PressErrorStateProps): JSX.Element {
    return (
        <StateEmpty title={title} description={message ?? '请稍后重试'}>
            <Button variant="outline" onClick={onRetry}>
                重试
            </Button>
        </StateEmpty>
    )
}
