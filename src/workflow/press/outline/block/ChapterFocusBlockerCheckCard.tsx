/**
 * 写前查纲的卡文自查卡片：围绕动机、冲突与章末钩子给出三项排查提示。
 * 复用约定：明细行与分隔线取 ChapterFocusParts，角色徽标取 constants 的 CHARACTER_ROLE_META，
 * 动机文案经共享兜底函数按人物逐个回落。
 * 关键约束：只读提示，不修改章纲；无出场人物时给出明确空状态文案；
 * 动机行只取人物卡已有的欲望与角色分类，不引入新的人物字段。
 */
import { Flame, Lightbulb, Swords } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { orFallback } from '@shared/utils/format'
import { Badge } from '@webview/blocks/Badge'
import { ChapterDetailItem, DETAIL_GROUP_CLASS, DetailSeparator } from './ChapterFocusParts'
import type { CharacterCard, OutlineChapter } from '../../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META } from '../../constants'

interface ChapterFocusBlockerCheckCardProps {
    cast: CharacterCard[]
    chapter: OutlineChapter
    hookLabel: string
}

/** 卡文自查：动机、冲突与章末钩子三项 */
export function ChapterFocusBlockerCheckCard({ cast, chapter, hookLabel }: ChapterFocusBlockerCheckCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>卡文时查三件事</CardTitle>
            </CardHeader>
            <CardContent>
                <ItemGroup className={DETAIL_GROUP_CLASS}>
                    <ChapterDetailItem
                        icon={Flame}
                        label="动机是否成立"
                        align="start"
                        value={
                            cast.length > 0 ? (
                                <span className="flex flex-col gap-1">
                                    {cast.map((character) => (
                                        <span key={character.id} className="flex items-start gap-1">
                                            <Badge
                                                variant="outline"
                                                className={CHARACTER_ROLE_META[character.role].className}
                                            >
                                                {CHARACTER_ROLE_META[character.role].label}
                                            </Badge>
                                            <span>
                                                {character.name}：{orFallback(character.desire, '欲望未填')}
                                            </span>
                                        </span>
                                    ))}
                                </span>
                            ) : (
                                '本章尚未指定出场人物'
                            )
                        }
                    />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Swords} label="冲突是否足够" value={chapter.obstacle} />
                    <DetailSeparator />
                    <ChapterDetailItem
                        icon={Lightbulb}
                        label="结尾有新问题"
                        value={
                            chapter.hook === 'none'
                                ? '章末没有留钩子，读者缺少看下一章的理由'
                                : `已留${hookLabel}钩子`
                        }
                    />
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
