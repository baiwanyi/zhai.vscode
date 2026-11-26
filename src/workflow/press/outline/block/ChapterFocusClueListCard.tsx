/**
 * 写前查纲的本章伏笔卡片：按埋设或回收位置筛出的线索，带类型与状态徽标。
 * 复用约定：引用匹配取 press/utils 的 isClueRefMatched，状态文案取 constants 元数据表并对非法值兜底。
 * 关键约束：只读展示，伏笔同时在本章埋设与回收时按埋设口径显示。
 */
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@components/ui/item'
import { Badge } from '@webview/blocks/Badge'
import type { OutlineChapterRef, OutlineClue } from '../../types'
import type { JSX } from 'react'
import { CLUE_STATUS_META } from '../../constants'
import { isClueRefMatched } from '../../utils'

interface ChapterFocusClueListCardProps {
    clues: OutlineClue[]
    chapterRef: OutlineChapterRef
}

/** 本章伏笔：按埋设或回收位置筛出的线索，带类型与状态徽标 */
export function ChapterFocusClueListCard({ clues, chapterRef }: ChapterFocusClueListCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>本章伏笔</CardTitle>
            </CardHeader>
            <CardContent>
                <ItemGroup className="gap-1">
                    {clues.map((clue) => {
                        const isPlant = isClueRefMatched(clue.plant, chapterRef)
                        return (
                            <Item key={clue.id} size="xs" variant="muted" className="flex-nowrap">
                                <ItemContent>
                                    <ItemTitle className="min-w-0 flex-1">{clue.name}</ItemTitle>
                                </ItemContent>
                                <ItemActions className="shrink-0">
                                    <Badge variant={isPlant ? 'outline' : 'secondary'}>
                                        {isPlant ? '埋设' : '回收'}
                                    </Badge>
                                    <Badge variant="outline">
                                        {CLUE_STATUS_META[clue.status]?.label ?? '未知'}
                                    </Badge>
                                </ItemActions>
                            </Item>
                        )
                    })}
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
