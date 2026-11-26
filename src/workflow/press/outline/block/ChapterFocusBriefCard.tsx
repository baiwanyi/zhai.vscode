/**
 * 写前查纲的本章章纲卡片：展示梗概与 POV、目标、阻碍、转折、结果、情绪、钩子七项明细。
 * 复用约定：明细行与分隔线取 ChapterFocusParts，张力与修订文案取 constants 元数据表，
 * 空值经共享兜底函数收口。
 * 关键约束：只读展示，钩子徽标只作提示，张力档位越界时文案回落空串；
 * 修订标记非正常时在卡片右上角提示，避免写前不知道本章已标废弃。
 */
import { Ban, Eye, FishingHook, Flag, GitBranch, Heart, Target } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { orFallback } from '@shared/utils/format'
import { Badge } from '@webview/blocks/Badge'
import { ChapterDetailItem, DETAIL_GROUP_CLASS, DetailSeparator } from './ChapterFocusParts'
import type { OutlineChapter } from '../../types'
import type { JSX } from 'react'
import { CHAPTER_REVISION_META, TENSION_LABELS } from '../../constants'

interface ChapterFocusBriefCardProps {
    chapter: OutlineChapter
    hookLabel: string
}

/** 本章章纲：梗概与六项明细，钩子附带张力档位徽标 */
export function ChapterFocusBriefCard({ chapter, hookLabel }: ChapterFocusBriefCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>这一章要写什么</CardTitle>
                {chapter.revision === 'normal' ? null : (
                    <CardAction>
                        <Badge variant={CHAPTER_REVISION_META[chapter.revision].tone}>
                            本章标记：{CHAPTER_REVISION_META[chapter.revision].label}
                        </Badge>
                    </CardAction>
                )}
                <CardDescription>{orFallback(chapter.summary, '本章暂无梗概')}</CardDescription>
            </CardHeader>
            <CardContent>
                <ItemGroup className={DETAIL_GROUP_CLASS}>
                    <ChapterDetailItem icon={Eye} label="POV" value={chapter.pov} />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Target} label="目标" value={chapter.goal} />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Ban} label="阻碍" value={chapter.obstacle} />
                    <DetailSeparator />
                    <ChapterDetailItem icon={GitBranch} label="转折" value={chapter.turn} />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Flag} label="结果" value={chapter.result} />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Heart} label="情绪" value={chapter.emotion} />
                    <DetailSeparator />
                    <ChapterDetailItem
                        icon={FishingHook}
                        label="钩子"
                        value={hookLabel}
                        action={
                            <Badge variant="outline">
                                {chapter.tension} {TENSION_LABELS[chapter.tension - 1] ?? ''}
                            </Badge>
                        }
                    />
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
