/**
 * 快照页空态与加载态：区分「正在读取」与「还没有任何版本」，避免首次进入时把加载中误读成空。
 * 复用约定：空态结构取 @components/ui 的 empty 套件，加载态用 spinner；不使用自定义占位容器。
 * 关键约束：空态文案必须说明自动留版规则，否则用户不知道何时会产生第一版。
 */
import { History } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Spinner } from '@components/ui/spinner'
import type { JSX } from 'react'

interface SnapshotEmptyProps {
    /** 首次加载中：只影响本组件展示，不阻塞页面其它区域 */
    isLoading: boolean
}

export function SnapshotEmpty({ isLoading }: SnapshotEmptyProps): JSX.Element {
    if (isLoading) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Spinner className="size-5" />
                <p>正在读取快照…</p>
            </div>
        )
    }
    return (
        <Empty className="border border-dashed border-border py-10">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <History />
                </EmptyMedia>
                <EmptyTitle>还没有快照</EmptyTitle>
                <EmptyDescription>
                    设定、角色或大纲内容有改动时会自动留一版；也可以点上方「立即快照」手动留一版。
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
