/**
 * 作品列表区块：卡片内组合标题与状态分派，加载中给骨架、无数据给引导、失败给重试。
 * 复用 @components/ui 的 card、item 与 skeleton，空态与失败态统一由业务公共层的 StateEmpty 承担，
 * 自身不取数、不持有筛选状态。
 * 关键约束：空态同时提供「添加作品」与「重建索引」，后者用于索引缓存被清空后恢复列表；
 * 加载态只渲染骨架不渲染条目，避免列表高度在骨架与数据之间跳动。
 */
import { BookOpen } from 'lucide-react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { PressProjectSummary } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { PressProjectCard } from './PressProjectCard'
import type { PressStatus } from '../utils'
import type { JSX } from 'react'

/** 加载态骨架条数：与常见作品数量同量级即可，不做分页占位 */
const LOADING_PLACEHOLDERS = [0, 1, 2] as const

interface PressProjectListProps {
    projects: PressProjectSummary[]
    status: PressStatus
    error: string | null
    onSelect: (dirPath: string) => void
    onAdd: () => void
    onRebuild: () => void
    onRetry: () => void
}

export function PressProjectList({
    projects,
    status,
    error,
    onSelect,
    onAdd,
    onRebuild,
    onRetry,
}: PressProjectListProps): JSX.Element {
    const count = projects.length
    const countLabel = status === 'ready' && count > 0 ? `${count} 部` : null

    return (
        <Card size="sm" className="ring-0">
            <CardHeader className="px-0 items-center">
                <CardTitle>作品列表</CardTitle>
                <CardAction className="row-span-1 text-muted-foreground">{countLabel}</CardAction>
            </CardHeader>
            <CardContent className="px-0">
                {status === 'loading' ? (
                    <div className="flex flex-col gap-2">
                        {LOADING_PLACEHOLDERS.map((placeholder) => (
                            <Skeleton key={placeholder} className="h-12 w-full rounded-xl" />
                        ))}
                    </div>
                ) : null}
                {status === 'error' ? (
                    <StateEmpty title="作品列表加载失败" description={error ?? '请稍后重试'} icon={BookOpen}>
                        <Button variant="outline" className="rounded-full" onClick={onRetry}>
                            重试
                        </Button>
                    </StateEmpty>
                ) : null}
                {status === 'ready' && count === 0 ? (
                    <StateEmpty
                        title="还没有作品"
                        description="作品以 press/ 下的子目录组织，新建后会自动生成背景、大纲与角色设定骨架文档。"
                        icon={BookOpen}
                    >
                        <Button className="rounded-full" onClick={onAdd}>
                            添加作品
                        </Button>
                        <Button variant="ghost" className="rounded-full" onClick={onRebuild}>
                            重建索引
                        </Button>
                    </StateEmpty>
                ) : null}
                {status === 'ready' && count > 0 ? (
                    <ItemGroup className="gap-2">
                        {projects.map((project) => (
                            <PressProjectCard key={project.dirPath} project={project} onSelect={onSelect} />
                        ))}
                    </ItemGroup>
                ) : null}
            </CardContent>
        </Card>
    )
}
