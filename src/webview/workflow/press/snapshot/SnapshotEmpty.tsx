/**
 * 快照页空态：区分「正在读取」与「还没有任何版本」，避免首次进入时把加载中误读成空。
 * 复用约定：结构取 @components/ui 的 empty 套件，加载态用 spinner，不另造占位容器；
 * 标题、说明与图标由调用方传入，设定/大纲与章节正文两条时间线共用本组件，差异只在文案与图标入参。
 * 关键约束：说明必须写清该时间线的自动留版规则与手动入口，否则用户不知道何时会产生第一版；
 * 加载态不渲染标题与说明，避免「还没有」与「正在读取」被同时读出。
 */
import { History } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Spinner } from '@components/ui/spinner'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

interface SnapshotEmptyProps {
    /** 首次加载中：只显示读取提示，不渲染标题与说明 */
    isLoading?: boolean
    /** 空态标题 */
    title: string
    /** 空态说明：写清自动留版规则与手动入口 */
    description: string
    /** 空态图标，缺省用历史图标 */
    icon?: LucideIcon
}

export function SnapshotEmpty({ isLoading = false, title, description, icon }: SnapshotEmptyProps): JSX.Element {
    const Icon = icon ?? History

    if (isLoading) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Spinner className="size-5" />
                <p>正在读取快照…</p>
            </div>
        )
    }
    return (
        <Empty className="h-full border border-dashed border-border">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
