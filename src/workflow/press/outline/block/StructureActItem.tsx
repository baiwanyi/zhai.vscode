/**
 * 结构纲阶段行：展示阶段名、转折类型、卷位与叙事作用，提供编辑与删除入口。
 * 复用约定：行容器取 @components/ui/item，徽标取 badge，按钮取 @webview/components/Button。
 * 关键约束：编辑与删除回调按 id 定位；摘要只显示卷位与叙事作用，不展示事件与主角变化。
 */
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import { Button } from '@webview/components/Button'
import type { OutlineAct } from '../../types'
import type { JSX } from 'react'
import { ACT_KIND_META } from '../../constants'

interface StructureActItemProps {
    act: OutlineAct
    index: number
    /** 卷位对应的卷名，未定卷位时为 null */
    volumeLabel: string | null
    onEdit: (actId: string) => void
    onRemove: (actId: string) => void
}

/** 结构纲阶段行：一行看全转折的类型、落点与叙事作用 */
export function StructureActItem({ act, index, volumeLabel, onEdit, onRemove }: StructureActItemProps): JSX.Element {
    const summary = [volumeLabel, act.narrativeRole]
        .filter((text): text is string => text !== null && text.length > 0)
        .join(' · ')

    return (
        <Item variant="outline">
            <ItemMedia variant="icon">
                <Badge variant="outline" className="tabular-nums">
                    {index + 1}
                </Badge>
            </ItemMedia>
            <ItemContent>
                <ItemTitle>
                    <span>{act.name.length > 0 ? act.name : '未命名阶段'}</span>
                    {act.kind === 'none' ? null : (
                        <Badge variant="outline">{ACT_KIND_META[act.kind]?.label ?? '未指定'}</Badge>
                    )}
                </ItemTitle>
                <ItemDescription className="whitespace-pre-line">
                    {summary.length > 0 ? summary : '内容为空，点右侧编辑'}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label={`编辑第 ${index + 1} 个阶段`}
                    onClick={(): void => onEdit(act.id)}
                >
                    <Pencil />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="hover:text-destructive rounded-full"
                    aria-label={`删除第 ${index + 1} 个阶段`}
                    onClick={(): void => onRemove(act.id)}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
}
