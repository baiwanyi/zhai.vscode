/**
 * 写前查纲的卷纲上下文卡片：折叠展示卷纲要点，并列出前情、接下来与后续章位置。
 * 复用约定：明细行与分隔线取 ChapterFocusParts，前后章文案取 layout/utils 的惰性拼接与共享兜底函数。
 * 关键约束：只读展示，前后章为空时由 chapterReferenceLabel 给出明确回退文案。
 */
import { ArrowRight, Clock3, List } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { orFallback } from '@shared/utils/format'
import { ChapterDetailItem, CollapsibleFocusRow, DETAIL_GROUP_CLASS, DetailSeparator } from './ChapterFocusParts'
import type { OutlineChapter, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import { chapterReferenceLabel } from '../utils/chapterFocusSnapshot'

interface ChapterFocusVolumeContextCardProps {
    volume: OutlineVolume
    prevChapter: OutlineChapter | null
    nextChapter: OutlineChapter | null
    nextChapters: OutlineChapter[]
}

/** 卷纲上下文：卷纲要点折叠行与前后章位置明细 */
export function ChapterFocusVolumeContextCard({
    volume,
    prevChapter,
    nextChapter,
    nextChapters,
}: ChapterFocusVolumeContextCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>卷纲 · {volume.name}</CardTitle>
                <CardDescription>卷纲要点与前后章位置</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
                <CollapsibleFocusRow label="核心事件" value={volume.coreEvent} />
                <CollapsibleFocusRow
                    label="主要情节"
                    value={volume.mainPlot
                        .map((item) => {
                            const text = item.trim()
                            return /[。！？.!?]$/u.test(text) ? text : `${text}。`
                        })
                        .join('\n')}
                />
                <CollapsibleFocusRow
                    label="关键转折"
                    value={volume.turningPoints
                        .map((item) => {
                            const text = item.trim()
                            return /[。！？.!?]$/u.test(text) ? text : `${text}。`
                        })
                        .join('\n')}
                />
                <CollapsibleFocusRow label="卷末结果" value={volume.result} />
                <ItemGroup className={DETAIL_GROUP_CLASS}>
                    <ChapterDetailItem
                        icon={Clock3}
                        label="前情"
                        value={chapterReferenceLabel(prevChapter, '本章是卷首，无前情', (chapter) =>
                            orFallback(chapter.summary, '上一章未填梗概'),
                        )}
                    />
                    <DetailSeparator />
                    <ChapterDetailItem
                        icon={ArrowRight}
                        label="接下来"
                        value={chapterReferenceLabel(nextChapter, '本卷最后一章', (chapter) =>
                            orFallback(chapter.goal, orFallback(chapter.summary, '下一章未填目标')),
                        )}
                    />
                    <DetailSeparator />
                    <ChapterDetailItem
                        icon={List}
                        label="后续章"
                        emphasized
                        value={
                            nextChapters.length > 0
                                ? nextChapters.map((chapter) => chapter.title).join(' / ')
                                : '无'
                        }
                    />
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
