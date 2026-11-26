/**
 * 成长节点识别卡片：列出 AI 从正文识别出的成长变化，供作者逐条采纳后追加到成长线。
 * 复用约定：卡片取 ui/card，清单取 ui/item 与 ToggleCheckItem，徽标取 blocks/Badge；
 * 章节坐标统一走 press/utils 的 formatChapterRefLabel，采纳键走 utils/backfill 的 growthKey。
 * 关键约束：识别按钮只上报点击，AI 请求由页面 hook 发起；采纳状态由调用方持有，本组件不写盘；
 * 未勾选的建议不影响落盘，坐标越界的建议已在宿主侧丢弃。
 */
import { Sparkles, TrendingUp } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import type { GrowthPointSuggestion } from '@shared/types/press'
import { Badge } from '@webview/blocks/Badge'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { GROWTH_TRACK_META } from '../../constants'
import { formatChapterRefLabel } from '../../utils'
import { ToggleCheckItem } from '../block/ToggleCheckItem'
import { growthKey } from '../utils/backfill'

interface BackfillGrowthSuggestionsCardProps {
    suggestions: readonly GrowthPointSuggestion[]
    acceptedGrowthKeys: readonly string[]
    isAnalyzing: boolean
    canAnalyze: boolean
    onAnalyze: () => void
    onToggleGrowth: (key: string) => void
}

/** 识别成长节点：AI 建议只作候选，勾选后随回填写入成长线 */
export function BackfillGrowthSuggestionsCard({
    suggestions,
    acceptedGrowthKeys,
    isAnalyzing,
    canAnalyze,
    onAnalyze,
    onToggleGrowth,
}: BackfillGrowthSuggestionsCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>识别成长节点</CardTitle>
                <CardDescription>从正文识别主角境界 / 战力与金手指等级的变化</CardDescription>
                <CardAction>
                    <Button
                        variant="ghost"
                        size="icon"
                        tooltip="识别成长节点"
                        isLoading={isAnalyzing}
                        disabled={!canAnalyze}
                        onClick={onAnalyze}
                    >
                        <Sparkles />
                    </Button>
                </CardAction>
            </CardHeader>
            {suggestions.length === 0 ? null : (
                <CardContent>
                    <ItemGroup className="gap-1">
                        {suggestions.map((suggestion) => {
                            const key = growthKey(suggestion)
                            const isAccepted = acceptedGrowthKeys.includes(key)
                            const trackMeta = GROWTH_TRACK_META[suggestion.track]
                            return (
                                <ToggleCheckItem
                                    key={key}
                                    isSelected={isAccepted}
                                    ariaLabel={
                                        isAccepted ? `取消采纳「${suggestion.value}」` : `采纳「${suggestion.value}」`
                                    }
                                    onToggle={(): void => onToggleGrowth(key)}
                                    title={
                                        <>
                                            <TrendingUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                            <span className="min-w-0 truncate">{suggestion.value}</span>
                                            <span className="shrink-0 text-muted-foreground">
                                                {formatChapterRefLabel({
                                                    volumeOrder: suggestion.volumeOrder,
                                                    chapterOrder: suggestion.chapterOrder,
                                                })}
                                            </span>
                                        </>
                                    }
                                    description={suggestion.note.length > 0 ? suggestion.note : undefined}
                                >
                                    <Badge variant={trackMeta.tone}>{trackMeta.label}</Badge>
                                </ToggleCheckItem>
                            )
                        })}
                    </ItemGroup>
                </CardContent>
            )}
        </Card>
    )
}
