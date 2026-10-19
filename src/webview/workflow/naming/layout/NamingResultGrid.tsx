/**
 * 结果区：展示一批候选名的自适应网格，含数量摘要、复制全部、错误与提示，以及空态引导。
 * 复用约定：空态复用 ui/empty，错误复用 ui/alert，卡片复用同目录 NamingResultCard；
 * 列数由 auto-fill 自适应，窄面板两列、拉宽后自动增加，避免写死列数在窄侧栏溢出。
 * 关键约束：结果区是页面唯一滚动容器（由父级设置），本组件本身不设 overflow，避免 Tooltip 被裁切。
 */
import { Copy, Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { NamingCandidate } from '@/shared/types/naming'
import { NamingResultCard } from './NamingResultCard'
import type { JSX } from 'react'
import { EMPTY_DESCRIPTION, EMPTY_TITLE } from '../constants'

interface NamingResultGridProps {
    items: NamingCandidate[]
    error: string | null
    notice: string | null
    onCopy: (name: string) => void
    onCopyAll: () => void
}

export function NamingResultGrid({
    items,
    error,
    notice,
    onCopy,
    onCopyAll,
}: NamingResultGridProps): JSX.Element {
    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex min-h-6 items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                    {items.length > 0 ? `已生成 ${items.length} 个名字` : '结果'}
                </p>
                {items.length > 0 ? (
                    <Button size="xs" variant="ghost" onClick={onCopyAll}>
                        <Copy data-icon="inline-start" />
                        复制全部
                    </Button>
                ) : null}
            </div>
            {error !== null ? (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}
            {notice !== null ? <p className="text-muted-foreground text-xs">{notice}</p> : null}
            {items.length === 0 ? (
                <Empty className="min-h-48">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Sparkles />
                        </EmptyMedia>
                        <EmptyTitle>{EMPTY_TITLE}</EmptyTitle>
                        <EmptyDescription>{EMPTY_DESCRIPTION}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                    {items.map((candidate) => (
                        <NamingResultCard key={candidate.id} candidate={candidate} onCopy={onCopy} />
                    ))}
                </div>
            )}
        </div>
    )
}
