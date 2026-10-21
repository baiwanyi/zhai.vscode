/**
 * 人物卡片列表：以单列卡片展示人物卡，承担人物页的主体浏览与选择入口。
 * 复用约定：卡片复用 ui/card，定位徽标取 CHARACTER_ROLE_META 的语义变体，空态复用 ui/empty；
 * 封面取人物卡的 coverPortraitId，未设置时显示占位图标；筛选与搜索由页面持有，本组件只接收已过滤的列表。
 * 关键约束：卡片是可聚焦按钮而非占位容器，键盘可逐项进入；排序固定按 CHARACTER_ROLE_ORDER，
 * 不随点击顺序变化，避免切换筛选后卡片位置跳动；卡片只展示封面与摘要，字段编辑一律在编辑弹窗内完成。
 */
import { Plus, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Card } from '@components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META, CHARACTER_ROLE_ORDER } from '../constants'

interface CharacterListProps {
    /** 已按筛选与搜索收敛过的人物卡 */
    characters: CharacterCard[]
    /** 全部人物数，用于区分「一个人都没有」与「没有匹配」 */
    totalCount: number
    /** 是否处于筛选或搜索状态，决定空态提供的出口 */
    hasFilter: boolean
    onSelect: (id: string) => void
    onCreate: () => void
    onClearFilter: () => void
}

export function CharacterList({
    characters,
    totalCount,
    hasFilter,
    onSelect,
    onCreate,
    onClearFilter,
}: CharacterListProps): JSX.Element {
    const sortedCharacters = useMemo(
        () =>
            [...characters].sort(
                (left, right) => CHARACTER_ROLE_ORDER.indexOf(left.role) - CHARACTER_ROLE_ORDER.indexOf(right.role),
            ),
        [characters],
    )

    if (sortedCharacters.length === 0) {
        return (
            <Empty className="border border-dashed border-border py-8">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <UserRound />
                    </EmptyMedia>
                    <EmptyTitle>{totalCount === 0 ? '还没有人物' : '没有匹配的人物'}</EmptyTitle>
                    <EmptyDescription>
                        {totalCount === 0 ? '先建立主角与对手，大纲才能排布冲突' : '换个关键词，或切回「全部」定位'}
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    {totalCount === 0 ? (
                        <Button size="sm" variant="outline" onClick={onCreate}>
                            <Plus data-icon="inline-start" />
                            新增人物
                        </Button>
                    ) : (
                        <Button size="sm" variant="ghost" disabled={!hasFilter} onClick={onClearFilter}>
                            清空筛选
                        </Button>
                    )}
                </EmptyContent>
            </Empty>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {sortedCharacters.map((character) => {
                const roleMeta = CHARACTER_ROLE_META[character.role]
                const summary = character.desire.length > 0 ? character.desire : '欲望未填写'
                const cover = character.portraits.find((item) => item.id === character.coverPortraitId)
                return (
                    <Card
                        key={character.id}
                        size="sm"
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer flex-row items-center gap-2.5 p-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        onClick={() => onSelect(character.id)}
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') {
                                return
                            }
                            event.preventDefault()
                            onSelect(character.id)
                        }}
                    >
                        <div className="aspect-3/4 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                            {cover !== undefined ? (
                                <img
                                    src={cover.url}
                                    alt={`${character.name} 的角色封面`}
                                    className="size-full object-cover"
                                />
                            ) : (
                                <div className="flex size-full items-center justify-center">
                                    <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                                </div>
                            )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className="min-w-0 truncate text-sm font-medium">{character.name}</span>
                                <Badge variant={roleMeta.tone} className="shrink-0">
                                    {roleMeta.label}
                                </Badge>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                                {character.identity.length > 0 ? character.identity : '未填写身份'}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{summary}</p>
                        </div>
                    </Card>
                )
            })}
        </div>
    )
}
