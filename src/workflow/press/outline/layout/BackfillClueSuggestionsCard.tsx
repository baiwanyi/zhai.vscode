/**
 * 伏笔位置识别卡片：列出 AI 识别出的埋设/回收建议，供作者逐条采纳。
 * 复用约定：卡片取 ui/card，清单取 ui/item 与 ToggleCheckItem；章节坐标统一走 press/utils 的 formatChapterRefLabel。
 * 关键约束：识别按钮只上报点击，AI 请求由页面 hook 发起；采纳状态由调用方持有，本组件不写盘。
 */
import { Sparkles } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import type { ClueRefSuggestion } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { formatChapterRefLabel } from '../../utils'
import { ToggleCheckItem } from '../block/ToggleCheckItem'
import { refKey } from '../utils/backfill'

export interface BackfillClueSuggestionsCardProps {
    suggestions: readonly ClueRefSuggestion[]
    clueNameById: ReadonlyMap<string, string>
    acceptedRefKeys: readonly string[]
    isAnalyzing: boolean
    canAnalyze: boolean
    onAnalyze: () => void
    onToggleRef: (key: string) => void
}

export function BackfillClueSuggestionsCard({
    suggestions,
    clueNameById,
    acceptedRefKeys,
    isAnalyzing,
    canAnalyze,
    onAnalyze,
    onToggleRef,
}: BackfillClueSuggestionsCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>识别伏笔位置</CardTitle>
                <CardDescription>从正文识别伏笔的埋设与回收位置</CardDescription>
                <CardAction>
                    <Button
                        variant="ghost"
                        size="icon"
                        tooltip="识别伏笔位置"
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
                            const key = refKey(suggestion)
                            const isAccepted = acceptedRefKeys.includes(key)
                            const clueName = clueNameById.get(suggestion.id) ?? suggestion.id
                            return (
                                <ToggleCheckItem
                                    key={key}
                                    isSelected={isAccepted}
                                    ariaLabel={isAccepted ? `取消采纳「${clueName}」` : `采纳「${clueName}」`}
                                    onToggle={() => onToggleRef(key)}
                                    title={
                                        <>
                                            {clueName}
                                            <span className="text-muted-foreground">
                                                {formatChapterRefLabel({
                                                    volumeOrder: suggestion.volumeOrder,
                                                    chapterOrder: suggestion.chapterOrder,
                                                })}
                                            </span>
                                        </>
                                    }
                                    actions={
                                        <Badge variant="outline">
                                            {suggestion.action === 'plant' ? '埋设' : '回收'}
                                        </Badge>
                                    }
                                />
                            )
                        })}
                    </ItemGroup>
                </CardContent>
            )}
        </Card>
    )
}
