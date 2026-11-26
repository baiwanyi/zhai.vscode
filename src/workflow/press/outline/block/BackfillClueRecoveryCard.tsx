/**
 * 伏笔回收卡片：列出仍埋设中的伏笔，供作者手动勾选已回收项，展示埋设/回收位置与触发者。
 * 复用约定：卡片取 ui/card，清单取 ui/item 与 ToggleCheckItem，位置徽标取 blocks/StatBadge，状态取 constants 元数据；
 * 章节坐标统一走 press/utils 的 formatChapterRefLabel。
 * 关键约束：无未回收伏笔时整卡不渲染；勾选只上报切换，自动回收与写盘由页面回填逻辑负责。
 */
import { SquareArrowRightEnter, SquareArrowRightExit, SquareExclamationPoint } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { StatBadge } from '@webview/blocks/StatBadge'
import type { CharacterCard, OutlineClue } from '../../types'
import type { JSX } from 'react'
import { CLUE_STATUS_META } from '../../constants'
import { formatChapterRefLabel } from '../../utils'
import { ToggleCheckItem } from '../block/ToggleCheckItem'

/** 伏笔的埋设/回收位置：按「卷X · X章」显示，未定用警示图标，精确口径走悬停提示 */
function ClueRefBadges({ clue }: { clue: OutlineClue }): JSX.Element {
    const plant = clue.plant === null ? null : formatChapterRefLabel(clue.plant)
    const payoff = clue.payoff === null ? null : formatChapterRefLabel(clue.payoff)
    return (
        <>
            <StatBadge tooltip={plant === null ? '埋设章未定' : `埋设章节 ${plant}`}>
                {plant === null ? (
                    <SquareExclamationPoint aria-hidden="true" />
                ) : (
                    <SquareArrowRightEnter aria-hidden="true" />
                )}
                {plant ?? '未定'}
            </StatBadge>
            <StatBadge tooltip={payoff === null ? '回收章未定' : `回收章节 ${payoff}`}>
                {payoff === null ? (
                    <SquareExclamationPoint aria-hidden="true" />
                ) : (
                    <SquareArrowRightExit aria-hidden="true" />
                )}
                {payoff ?? '未定'}
            </StatBadge>
        </>
    )
}

export interface BackfillClueRecoveryCardProps {
    clues: readonly OutlineClue[]
    selectedIds: readonly string[]
    characters: readonly CharacterCard[]
    onToggleClue: (clueId: string) => void
}

export function BackfillClueRecoveryCard({
    clues,
    selectedIds,
    characters,
    onToggleClue,
}: BackfillClueRecoveryCardProps): JSX.Element | null {
    if (clues.length === 0) {
        return null
    }
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>伏笔回收</CardTitle>
                <CardAction>
                    <Badge variant="outline">{clues.length} 条未回收</Badge>
                </CardAction>
                <CardDescription>正文写完的回收章自动标记，其余可手动勾选</CardDescription>
            </CardHeader>
            <CardContent>
                <ItemGroup className="gap-1">
                    {clues.map((clue) => {
                        const isSelected = selectedIds.includes(clue.id)
                        const trigger = characters.find((character) => character.id === clue.triggerId)
                        return (
                            <ToggleCheckItem
                                key={clue.id}
                                isSelected={isSelected}
                                ariaLabel={isSelected ? `取消回收「${clue.name}」` : `标记「${clue.name}」已回收`}
                                onToggle={() => onToggleClue(clue.id)}
                                title={clue.name}
                                description={
                                    <>
                                        <ClueRefBadges clue={clue} />
                                        <Badge variant="outline">
                                            {trigger === undefined ? '未指定触发者' : trigger.name}
                                        </Badge>
                                        <Badge variant="outline">{CLUE_STATUS_META[clue.status].label}</Badge>
                                    </>
                                }
                            />
                        )
                    })}
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
