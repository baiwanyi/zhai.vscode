/**
 * 作品条目：一行呈现作品封面、作品名与章节数、字数、最近更新时间，点击进入作品详情。
 * 复用 @components/ui/item 的条目语义（含 ItemMedia 槽位）与 press/utils 的元信息口径；条目自带描边，滚动中可清晰分隔。
 * 关键约束：作品名超长时单行截断；封面取作品设定页选定的封面，沿用 ItemMedia 的 image 槽位（sm 下为方形小图），未设封面时显示占位图标；
 * 条目默认 flex-wrap，窄侧栏遇到长标题会把封面挤到单独一行，故显式 flex-nowrap 并让内容区 min-w-0 可收缩、
 * 操作区 shrink-0 不参与压缩；条目不再直接打开 README（该动作下沉到详情页页头），整行可点且不额外挂操作按钮。
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
            className="flex-nowrap cursor-pointer rounded-xl px-2 py-1.5 hover:bg-muted"
            aria-label={`查看作品 ${project.name}`}
            onClick={() => onSelect(project.dirPath)}
        >
            <ItemMedia variant="image" className="rounded-full">
                {project.coverUrl === undefined ? (
                    <ImageIcon className="size-4 text-muted-foreground" />
                ) : (
                    <img src={project.coverUrl} alt={`${project.name} 的封面`} className="size-full object-cover" />
                )}
            </ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="w-full truncate">{project.name}</ItemTitle>
                <ItemDescription className="truncate text-xs">{formatProjectMeta(project)}</ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0">
                <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
        </Item>
    )
}
