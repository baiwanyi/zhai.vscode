/**
 * 伏笔行：展示伏笔名、类型、状态与备注，提供编辑与删除入口。
 * 复用约定：行容器取 @components/ui/item 的槽位，徽标取 badge，按钮取 @webview/components/Button。
 * 关键约束：编辑与删除回调按伏笔 id 定位；埋收位置与触发者只在编辑弹窗里维护，本行不重复展示。
 */
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
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
                    <Badge variant={meta.tone}>{meta.label}</Badge>
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
                <Button
                    variant="ghost"
                    size="icon"
                    className="hover:text-destructive rounded-full"
                    aria-label={`删除第 ${index + 1} 条伏笔`}
                    onClick={(): void => onRemove(clue.id)}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
}
