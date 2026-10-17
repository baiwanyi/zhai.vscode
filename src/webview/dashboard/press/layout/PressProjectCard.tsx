/**
 * 作品条目：一行呈现作品名与章节数、字数、最近更新时间，点击即打开作品 README。
 * 复用 @/components/ui/item 的条目语义、仪表盘共享的相对时间与字数格式化。
 * 关键约束：作品名超长时单行截断，元信息缺失（无有效时间）时不留空分隔符；
 * 条目整行可点，不额外挂操作按钮，避免在窄侧栏里挤压点击区域。
 */
import { ChevronRight } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import type { PressProjectSummary } from '@/shared/types/press'
import type { JSX } from 'react'
import { formatRelativeTime } from '../../../utils'
import { formatWordCount } from '../../utils'

interface PressProjectCardProps {
    project: PressProjectSummary
    onOpen: (dirPath: string) => void
}

export function PressProjectCard({ project, onOpen }: PressProjectCardProps): JSX.Element {
    const meta = [
        `${project.chapterCount} 章`,
        `${formatWordCount(project.wordCount)} 字`,
        formatRelativeTime(project.mtime),
    ]
        .filter((part) => part.length > 0)
        .join(' · ')

    return (
        <Item
            size="sm"
            className="cursor-pointer rounded-xl px-2 py-1.5 hover:bg-muted"
            aria-label={`打开作品 ${project.name}`}
            onClick={() => onOpen(project.dirPath)}
        >
            <ItemContent>
                <ItemTitle className="w-full truncate">{project.name}</ItemTitle>
                <ItemDescription className="text-xs">{meta}</ItemDescription>
            </ItemContent>
            <ItemActions>
                <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
        </Item>
    )
}
