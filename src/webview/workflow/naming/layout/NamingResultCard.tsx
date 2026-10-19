/**
 * 结果卡片：单个候选名的展示与复制入口，悬停时浮现复制按钮。
 * 复用约定：容器复用 ui/card（sm 尺寸），按钮复用 ui/button 的 icon-xs 变体，图标取自 lucide-react。
 * 关键约束：名字可能较长，用 truncate 保证网格不被撑开，完整内容通过 title 悬浮可见。
 */
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { NamingCandidate } from '@/shared/types/naming'
import type { JSX } from 'react'

interface NamingResultCardProps {
    candidate: NamingCandidate
    onCopy: (name: string) => void
}

export function NamingResultCard({ candidate, onCopy }: NamingResultCardProps): JSX.Element {
    return (
        <Card size="sm" className="group/name gap-0 py-1.5">
            <CardContent className="flex items-center gap-1 px-2">
                <span className="min-w-0 flex-1 truncate text-sm" title={candidate.name}>
                    {candidate.name}
                </span>
                <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100"
                    aria-label={`复制 ${candidate.name}`}
                    onClick={() => onCopy(candidate.name)}
                >
                    <Copy data-icon="inline-start" />
                </Button>
            </CardContent>
        </Card>
    )
}
