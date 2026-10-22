/**
 * 结果区：展示当前分类的一批候选名，含数量摘要、复制全部、错误提示与空态引导。
 * 复用约定：空态复用 ui/empty，错误复用 ui/alert，候选卡片复用同目录 NamingResultCard；
 * 复制反馈统一走 sonner，不在按钮内切换图标或文案。
 * 关键约束：结果区是页面唯一滚动容器（由父级设置）；列数由 auto-fill 自适应，窄面板两列、拉宽后自动增加。
 */
import { Copy, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Button } from '@components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { NamingCandidate } from '@shared/types/naming'
import { NamingResultCard } from './NamingResultCard'
import type { JSX } from 'react'
import { EMPTY_DESCRIPTION, EMPTY_TITLE } from '../constants'
import { copyName, joinNames } from '../utils'

interface NamingResultGridProps {
    items: NamingCandidate[]
    error: string | null
}

export function NamingResultGrid({ items, error }: NamingResultGridProps): JSX.Element {
    const handleCopyAll = async (): Promise<void> => {
        const isSuccess = await copyName(joinNames(items))
        if (isSuccess) {
            toast.success(`已复制 ${items.length} 个名字`)
            return
        }
        toast.error('复制失败，请手动选中后复制')
    }

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex min-h-6 items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                    {items.length > 0 ? `已生成 ${items.length} 个名字` : '结果'}
                </p>
                {items.length > 0 ? (
                    <Button variant="ghost" onClick={() => void handleCopyAll()}>
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
            {items.length === 0 ? (
                <Empty className="min-h-40">
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
                        <NamingResultCard key={candidate.id} candidate={candidate} />
                    ))}
                </div>
            )}
        </div>
    )
}
