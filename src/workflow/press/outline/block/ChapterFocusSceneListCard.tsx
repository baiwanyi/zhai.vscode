/**
 * 写前查纲的场景清单卡片：每场戏按五项字段逐条展示，未填字段不渲染。
 * 复用约定：字段顺序与标签取 constants 的 SCENE_FIELD_META，标题取 press/utils 的 sceneTitleLabel。
 * 关键约束：只读展示，空标题回落为空串由调用方指定，底部分割线不出现在最后一条明细。
 */
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@components/ui/item'
import type { OutlineScene } from '../../types'
import type { JSX } from 'react'
import { SCENE_FIELD_META } from '../../constants'
import { sceneTitleLabel } from '../../utils'

interface ChapterFocusSceneListCardProps {
    scenes: OutlineScene[]
}

/** 场景清单：每场戏的五项明细逐条显示，未填字段不渲染 */
export function ChapterFocusSceneListCard({ scenes }: ChapterFocusSceneListCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>场景清单</CardTitle>
            </CardHeader>
            <CardContent>
                <ItemGroup className="gap-1">
                    {scenes.map((scene) => (
                        <Item key={scene.id} size="xs" variant="muted">
                            <ItemContent className="gap-2">
                                <ItemTitle className="line-clamp-none w-full">{sceneTitleLabel(scene, '')}</ItemTitle>
                                {SCENE_FIELD_META.map(([label, key]) => {
                                    const value = scene[key]
                                    return value.length > 0 ? (
                                        <ItemDescription
                                            key={label}
                                            className="line-clamp-none flex w-full gap-2 border-b border-border/40 py-2 last:border-b-0 last:pb-0"
                                        >
                                            <span className="shrink-0 text-foreground">{label}</span>
                                            <span className="min-w-0 flex-1 text-right">{value}</span>
                                        </ItemDescription>
                                    ) : null
                                })}
                            </ItemContent>
                        </Item>
                    ))}
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
