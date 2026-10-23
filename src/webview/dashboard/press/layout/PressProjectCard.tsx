/**
 * 作品条目：一行呈现作品封面、作品名与章节数、字数、最近更新时间，点击进入作品详情。
 * 复用 @components/ui/item 的条目语义（含 ItemMedia 槽位）与 press/utils 的元信息口径；条目自带描边，滚动中可清晰分隔。
 * 关键约束：作品名超长时单行截断；封面取作品设定页选定的封面（缩略图按 2:3 裁切），未设封面时显示占位图标；
 * 条目不再直接打开 README（该动作下沉到详情页页头），整行可点且不额外挂操作按钮，避免在窄侧栏里挤压点击区域。
 */
import { ChevronRight, ImageIcon } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import type { PressProjectSummary } from '@shared/types/press'
import type { JSX } from 'react'
import { formatProjectMeta } from '../utils'

interface PressProjectCardProps {
    project: PressProjectSummary
    onSelect: (dirPath: string) => void
}

export function PressProjectCard({ project, onSelect }: PressProjectCardProps): JSX.Element {
    return (
        <Item
            variant="outline"
            size="sm"
            className="cursor-pointer rounded-xl px-2 py-1.5 hover:bg-muted"
            aria-label={`查看作品 ${project.name}`}
            onClick={() => onSelect(project.dirPath)}
        >
            <ItemMedia className="h-12 w-8 overflow-hidden rounded-sm border border-border">
                {project.coverUrl === undefined ? (
                    <ImageIcon className="size-4 text-muted-foreground" />
                ) : (
                    <img src={project.coverUrl} alt={`${project.name} 的封面`} className="size-full object-cover" />
                )}
            </ItemMedia>
            <ItemContent>
                <ItemTitle className="w-full truncate">{project.name}</ItemTitle>
                <ItemDescription className="text-xs">{formatProjectMeta(project)}</ItemDescription>
            </ItemContent>
            <ItemActions>
                <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
        </Item>
    )
}
