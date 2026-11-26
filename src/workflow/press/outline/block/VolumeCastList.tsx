/**
 * 卷内出场名单：按角色分类分行展示本卷有出场章节的人物，每人一个「性别图标 + 姓名 · N 章」徽标。
 * 复用约定：角色顺序与中文标签取 press/constants 的 CHARACTER_ROLE_ORDER / CHARACTER_ROLE_META，
 * 徽标取 @webview/blocks/Badge，性别图标取 press/layout 的 CharacterGenderIcon（与人物列表共用）。
 * 关键约束：入参是 summarizeVolumeCast 的聚合结果，组件内部只做零出场过滤与分类、不重新统计；
 * 每行两列布局：角色标签独占左列且顶部对齐，徽标只在右列内换行；
 * 无出场人物时渲染 emptyText 占位，空分类行不渲染；只读展示，不提供任何编辑入口。
 */
import { cn } from 'cn'
import { Badge } from '@webview/blocks/Badge'
import { CharacterGenderIcon } from '@webview/blocks/CharacterGenderIcon'
import type { VolumeCastSummary } from '../../utils'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META, CHARACTER_ROLE_ORDER } from '../../constants'

interface VolumeCastListProps {
    /** 本卷出场统计：传 summarizeVolumeCast 的结果，零出场人物由组件过滤 */
    cast: readonly VolumeCastSummary[]
    /** 没有任何出场人物时的占位文案 */
    emptyText?: string
    /** 外层附加类名：调用方按容器宽度调整间距 */
    className?: string
}

/** 出场名单：分类分行 + 每人一个徽标，卷卡片与卷末统计共用 */
export function VolumeCastList({ cast, emptyText = '暂无', className }: VolumeCastListProps): JSX.Element {
    const appeared = cast.filter((item) => item.chapterCount > 0)
    if (appeared.length === 0) {
        return <p className={cn('text-muted-foreground/70', className)}>{emptyText}</p>
    }
    const groups = CHARACTER_ROLE_ORDER.map((role) => ({
        role,
        label: CHARACTER_ROLE_META[role].label,
        items: appeared.filter((item) => item.character.role === role),
    })).filter((group) => group.items.length > 0)
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            {groups.map((group) => (
                <div key={group.role} className="grid grid-cols-[auto_1fr] items-start gap-1 mb-1">
                    <span className="text-foreground text-sm pr-2">{group.label}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {group.items.map((item) => (
                            <Badge key={item.character.id} variant="outline" className="gap-1 font-normal">
                                <CharacterGenderIcon gender={item.character.gender} className="size-3" />
                                {item.character.name}
                                <span className="text-muted-foreground">· {item.chapterCount} 章</span>
                            </Badge>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
