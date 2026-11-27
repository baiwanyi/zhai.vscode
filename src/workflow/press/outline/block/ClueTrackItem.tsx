/**
 * 伏笔行：展示伏笔名、类型、状态与备注，提供编辑与删除入口。
 * 复用约定：行容器取 @components/ui/item 的槽位，徽标取 badge，按钮取 @webview/components/Button，
 * 删除入口取 blocks/DeleteConfirmButton（图标按钮 + 二次确认）。
 * 关键约束：编辑与删除回调按伏笔 id 定位；埋收位置与触发者只在编辑弹窗里维护，本行不重复展示；
 * 「计划中」的伏笔（未回收但埋设章未定）徽标显示「未指定」，与「已埋待收」区分。
 */
import { Pencil } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import { Badge } from '@webview/blocks/Badge'
import { DeleteConfirmButton } from '@webview/blocks/DeleteConfirmButton'
import { Button } from '@webview/components/Button'
import type { OutlineClue } from '../../types'
import type { JSX } from 'react'
import { CLUE_KIND_META, CLUE_STATUS_META } from '../../constants'

interface ClueTrackItemProps {
    clue: OutlineClue
    index: number
    onEdit: (clueId: string) => void
    onRemove: (clueId: string) => void
}

/** 伏笔行：一行看全伏笔名、状态与备注 */
export function ClueTrackItem({ clue, index, onEdit, onRemove }: ClueTrackItemProps): JSX.Element {
    const meta = CLUE_STATUS_META[clue.status] ?? CLUE_STATUS_META.planted
    const kindMeta = CLUE_KIND_META[clue.kind]
    /** 未回收但埋设章未定：仍是计划中的伏笔，不能标成「未回收」误导作者 */
    const isUnplanned = clue.status === 'planted' && clue.plant === null
    const statusLabel = isUnplanned ? '未指定' : meta.label

    return (
        <Item variant="outline" size="sm">
            <ItemMedia variant="icon">
                <Badge variant="outline" className="tabular-nums">
                    {index + 1}
                </Badge>
            </ItemMedia>
            <ItemContent>
                <ItemTitle>
                    <span>{clue.name.length > 0 ? clue.name : '未命名伏笔'}</span>
                    {clue.kind === 'none' || kindMeta === undefined ? null : (
                        <Badge variant={kindMeta.tone}>{kindMeta.label}</Badge>
                    )}
                    <Badge variant={meta.tone}>{statusLabel}</Badge>
                </ItemTitle>
                {clue.note.length > 0 ? (
                    <ItemDescription className="whitespace-pre-line">{clue.note}</ItemDescription>
                ) : null}
            </ItemContent>
            <ItemActions>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label={`编辑第 ${index + 1} 条伏笔`}
                    onClick={(): void => onEdit(clue.id)}
                >
                    <Pencil />
                </Button>
                <DeleteConfirmButton
                    tooltip={`删除第 ${index + 1} 条伏笔`}
                    title="删除这条伏笔？"
                    description="删除后不可恢复，该伏笔会从伏笔线中移除。"
                    variant="ghost"
                    className="opacity-100 rounded-full hover:text-destructive"
                    onConfirm={(): void => onRemove(clue.id)}
                />
            </ItemActions>
        </Item>
    )
}
