/**
 * 人物列表：按定位排序展示全部人物卡，提供检索与新增入口，是大纲页与人物页共用的选择源。
 * 复用约定：列表项复用 ui/item 与 ui/badge，搜索框复用 ui/input 并接入全局 placeholder 令牌；
 * 选中态取主题的列表选中色（accent），与作品章节树的选中观感保持一致。
 * 关键约束：列表项是可聚焦按钮而非 div，键盘可逐项进入；检索只匹配姓名、别名与身份，
 * 不搜索人物卡正文，避免输入一个常用字就把整份设定命中。
 */
import { cn } from 'cn'
import { Plus, Search, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import type { CharacterCard, CharacterRole } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META } from '../constants'

/** 列表排序：主角在前、反派在后，与作者翻卡的顺序一致 */
const ROLE_ORDER: readonly CharacterRole[] = ['protagonist', 'heroine', 'supporting', 'antagonist']

interface CharacterListProps {
    characters: CharacterCard[]
    selectedId: string | null
    onSelect: (id: string) => void
    onCreate: () => void
}

export function CharacterList({ characters, selectedId, onSelect, onCreate }: CharacterListProps): JSX.Element {
    const [query, setQuery] = useState('')

    const visibleCharacters = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        const matched =
            keyword.length === 0
                ? characters
                : characters.filter((character) =>
                      [character.name, character.alias, character.identity].some((field) =>
                          field.toLowerCase().includes(keyword),
                      ),
                  )
        return [...matched].sort((left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role))
    }, [characters, query])

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="relative">
                <Search
                    className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    value={query}
                    aria-label="搜索人物"
                    placeholder="搜索姓名、别名或身份"
                    className="h-7 pl-7 text-xs"
                    onChange={(event) => setQuery(event.target.value)}
                />
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground tabular-nums">{visibleCharacters.length} 人</span>
                <Button size="xs" variant="ghost" className="rounded-full" onClick={onCreate}>
                    <Plus data-icon="inline-start" />
                    新增人物
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {visibleCharacters.length === 0 ? (
                    <Empty className="border border-dashed border-border py-8">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <UserRound />
                            </EmptyMedia>
                            <EmptyTitle>还没有人物</EmptyTitle>
                            <EmptyDescription>
                                {characters.length === 0 ? '先建立主角与对手，大纲才能排布冲突' : '没有匹配的人物'}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {visibleCharacters.map((character) => {
                            const roleMeta = CHARACTER_ROLE_META[character.role]
                            const isSelected = character.id === selectedId
                            return (
                                <Item
                                    key={character.id}
                                    size="xs"
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    className={cn(
                                        'w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                                        isSelected && 'bg-accent text-accent-foreground',
                                    )}
                                    onClick={() => onSelect(character.id)}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') {
                                            return
                                        }
                                        event.preventDefault()
                                        onSelect(character.id)
                                    }}
                                >
                                    <ItemContent className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <ItemTitle className="min-w-0 truncate text-xs">{character.name}</ItemTitle>
                                            <Badge variant={roleMeta.tone} className="shrink-0">
                                                {roleMeta.label}
                                            </Badge>
                                        </div>
                                        <ItemDescription className="truncate text-xs">
                                            {character.identity.length > 0 ? character.identity : '未填写身份'}
                                        </ItemDescription>
                                    </ItemContent>
                                </Item>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
