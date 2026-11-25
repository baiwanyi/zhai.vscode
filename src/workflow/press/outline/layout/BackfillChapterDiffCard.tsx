/**
 * 回填差异卡片：列出章纲计划与章节事实有出入的章节，供作者逐章勾选回填。
 * 复用约定：卡片取 ui/card，清单取 ui/item 与 ToggleCheckItem，空/加载态取 blocks/StateEmpty；
 * 章节标题与字数取 press/utils 的 chapterTitleLabel / formatWordCount。
 * 关键约束：加载中或无可回填差异时显示 StateEmpty；重新读取只上报点击，事实刷新由页面 hook 负责。
 */
import { RefreshCw } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import type { BackfillRow } from '../utils/backfill'
import type { JSX } from 'react'
import { chapterTitleLabel, formatWordCount } from '../../utils'
import { ToggleCheckItem } from '../block/ToggleCheckItem'

export interface BackfillChapterDiffCardProps {
    rows: readonly BackfillRow[]
    selectedChapterIds: readonly string[]
    isLoading: boolean
    onReload: () => void
    onToggleChapter: (chapterId: string) => void
}

export function BackfillChapterDiffCard({
    rows,
    selectedChapterIds,
    isLoading,
    onReload,
    onToggleChapter,
}: BackfillChapterDiffCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>章纲差异</CardTitle>
                <CardDescription>共 {rows.length} 章待确认</CardDescription>
                <CardAction>
                    <Button variant="ghost" size="icon" tooltip="重新读取" onClick={onReload}>
                        <RefreshCw />
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                {isLoading || rows.length === 0 ? (
                    <StateEmpty
                        icon={RefreshCw}
                        title={isLoading ? '正在读取章节事实...' : '没有需要回填的差异'}
                        isLoading={isLoading}
                        className="py-8"
                    />
                ) : (
                    <ItemGroup className="gap-1">
                        {rows.map((row) => {
                            const isSelected = selectedChapterIds.includes(row.chapter.id)
                            return (
                                <ToggleCheckItem
                                    key={row.chapter.id}
                                    isSelected={isSelected}
                                    ariaLabel={isSelected ? '取消回填该章' : '回填该章'}
                                    onToggle={() => onToggleChapter(row.chapter.id)}
                                    title={
                                        <>
                                            {chapterTitleLabel(row.chapter)}
                                            {row.hasWordCountChange ? (
                                                <span className="text-muted-foreground tabular-nums">
                                                    {formatWordCount(row.chapter.wordCount)} →{' '}
                                                    {formatWordCount(row.factWordCount)}
                                                </span>
                                            ) : null}
                                        </>
                                    }
                                    descriptionClassName="truncate"
                                    description={row.hasSummaryChange ? row.factSummary : '实际摘要无变化'}
                                    actions={<Badge variant="outline">{row.volumeName}</Badge>}
                                />
                            )
                        })}
                    </ItemGroup>
                )}
            </CardContent>
        </Card>
    )
}
