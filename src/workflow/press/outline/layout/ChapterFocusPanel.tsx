/**
 * 写前查纲面板：以只读卡片呈现本章章纲、卡文自查、场景、伏笔与前后章关系，并列出将注入 AI 对话的引用。
 * 复用约定：卡片与引用行取 @components/ui 的 card / item，状态与钩子文案取 constants 元数据表；
 * 数据由调用方按当前章传入，setting 仅用于展示注入对话的题材与风格。
 * 关键约束：全部只读、不改章纲数据；「本次引用」只作展示，实际注入由对话框底部的「添加到AI对话」动作完成。
 */
import { BookMarked, ClipboardCheck, Globe, ScrollText, Users } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardContent } from '@components/ui/card'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import type {
    CharacterCard,
    OutlineChapter,
    OutlineChapterRef,
    OutlinePlan,
    OutlineVolume,
    ProjectSetting,
} from '../../types'
import type { JSX } from 'react'
import { CLUE_STATUS_META, HOOK_OPTIONS, PLAN_STATUS_META, TENSION_LABELS } from '../../constants'
import { chapterTitleLabel } from '../../utils'

interface ChapterFocusPanelProps {
    setting: ProjectSetting
    volume: OutlineVolume
    chapter: OutlineChapter
    chapterRef: OutlineChapterRef
    characters: CharacterCard[]
    plan: OutlinePlan
    prevChapter: OutlineChapter | null
    nextChapter: OutlineChapter | null
}

/** 聚焦视图的一行只读字段：标签固定宽度，内容可换行 */
function FocusRow({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="flex gap-2">
            <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 flex-1">{value.length > 0 ? value : '未填写'}</span>
        </div>
    )
}

/** 写前查纲：只盯当前章与其前后章关系，固定只读区辅助卡文时排查 */
export function ChapterFocusPanel({
    setting,
    volume,
    chapter,
    chapterRef,
    characters,
    plan,
    prevChapter,
    nextChapter,
}: ChapterFocusPanelProps): JSX.Element {
    const cast = characters.filter((character) => chapter.characterIds.includes(character.id))
    const hookLabel = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无'
    const relatedClues = plan.clues.filter(
        (clue) =>
            (clue.plant !== null &&
                clue.plant.volumeOrder === chapterRef.volumeOrder &&
                clue.plant.chapterOrder === chapterRef.chapterOrder) ||
            (clue.payoff !== null &&
                clue.payoff.volumeOrder === chapterRef.volumeOrder &&
                clue.payoff.chapterOrder === chapterRef.chapterOrder),
    )
    const selectedCharacters = characters.filter((character) => chapter.characterIds.includes(character.id))
    const characterLabel =
        selectedCharacters.length > 0
            ? selectedCharacters.map((character) => character.name).join('、')
            : '未指定出场人物'
    const settingLabel = `${setting.genres.join(' / ') || '未填题材'} · ${setting.tone || '未填风格'}`

    return (
        <div className="flex flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
                <ClipboardCheck className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="shrink-0 font-medium">写前查纲</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {volume.name} · {chapterTitleLabel(chapter)}
                </span>
                <Badge variant="outline">{PLAN_STATUS_META[chapter.status].label}</Badge>
            </header>

            <div className="flex flex-col gap-3 px-3 py-3">
                <Card size="sm" className="gap-0">
                    <CardContent className="flex flex-col gap-1.5">
                        <span className="font-medium">本次引用</span>
                        <Item size="xs" variant="muted" className="gap-2">
                            <BookMarked className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <ItemContent className="min-w-0">
                                <ItemTitle>卷纲</ItemTitle>
                                <ItemDescription className="truncate">{volume.name}</ItemDescription>
                            </ItemContent>
                        </Item>
                        <Item size="xs" variant="muted" className="gap-2">
                            <ScrollText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <ItemContent className="min-w-0">
                                <ItemTitle>章纲</ItemTitle>
                                <ItemDescription className="truncate">
                                    {chapterTitleLabel(chapter)} · {chapter.beats.length} 条节拍
                                </ItemDescription>
                            </ItemContent>
                        </Item>
                        <Item size="xs" variant="muted" className="gap-2">
                            <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <ItemContent className="min-w-0">
                                <ItemTitle>人物</ItemTitle>
                                <ItemDescription className="truncate">{characterLabel}</ItemDescription>
                            </ItemContent>
                        </Item>
                        <Item size="xs" variant="muted" className="gap-2">
                            <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <ItemContent className="min-w-0">
                                <ItemTitle>设定</ItemTitle>
                                <ItemDescription className="truncate">{settingLabel}</ItemDescription>
                            </ItemContent>
                        </Item>
                    </CardContent>
                </Card>

                <Card size="sm" className="gap-0">
                    <CardContent className="flex flex-col gap-1.5">
                        <span className="font-medium">这一章要写什么</span>
                        <FocusRow label="POV" value={chapter.pov} />
                        <FocusRow label="目标" value={chapter.goal} />
                        <FocusRow label="阻碍" value={chapter.obstacle} />
                        <FocusRow label="转折" value={chapter.turn} />
                        <FocusRow label="结果" value={chapter.result} />
                        <FocusRow label="情绪" value={chapter.emotion} />
                        <FocusRow label="梗概" value={chapter.summary} />
                        <div className="flex gap-2">
                            <span className="w-16 shrink-0 text-muted-foreground">钩子</span>
                            <span className="min-w-0 flex-1">{hookLabel}</span>
                            <span className="shrink-0 text-muted-foreground">
                                {chapter.tension} {TENSION_LABELS[chapter.tension - 1] ?? ''}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card size="sm" className="gap-0">
                    <CardContent className="flex flex-col gap-1.5">
                        <span className="font-medium">卡文时查三件事</span>
                        <FocusRow
                            label="动机是否成立"
                            value={
                                cast.length > 0
                                    ? cast
                                          .map((character) => `${character.name}：${character.desire || '欲望未填'}`)
                                          .join('；')
                                    : '本章尚未指定出场人物'
                            }
                        />
                        <FocusRow label="冲突是否足够" value={chapter.obstacle} />
                        <FocusRow
                            label="结尾有新问题"
                            value={
                                chapter.hook === 'none'
                                    ? '章末没有留钩子，读者缺少看下一章的理由'
                                    : `已留${hookLabel}钩子`
                            }
                        />
                    </CardContent>
                </Card>

                {chapter.scenes.length > 0 ? (
                    <Card size="sm" className="gap-0">
                        <CardContent className="flex flex-col gap-2">
                            <span className="font-medium">场景清单</span>
                            {chapter.scenes.map((scene) => (
                                <div
                                    key={scene.id}
                                    className="flex flex-col gap-0.5 rounded-lg bg-muted/30 px-2 py-1.5"
                                >
                                    <span>
                                        场景{scene.order} {scene.title}
                                    </span>
                                    <span className="text-muted-foreground">
                                        欲望：{scene.desire || '未填'} · 阻碍：{scene.obstacle || '未填'} · 选择：
                                        {scene.choice || '未填'}
                                    </span>
                                    <span className="text-muted-foreground">
                                        结果：{scene.result || '未填'} · 情绪变化：{scene.emotion || '未填'}
                                    </span>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ) : null}

                <Card size="sm" className="gap-0">
                    <CardContent className="flex flex-col gap-1.5">
                        <span className="font-medium">本章伏笔</span>
                        {relatedClues.length === 0 ? (
                            <span className="text-muted-foreground">本章没有埋设或回收的伏笔。</span>
                        ) : (
                            relatedClues.map((clue) => {
                                const isPlant =
                                    clue.plant !== null &&
                                    clue.plant.volumeOrder === chapterRef.volumeOrder &&
                                    clue.plant.chapterOrder === chapterRef.chapterOrder
                                return (
                                    <div key={clue.id} className="flex items-center gap-1.5">
                                        <Badge variant={isPlant ? 'outline' : 'secondary'}>
                                            {isPlant ? '埋设' : '回收'}
                                        </Badge>
                                        <span className="min-w-0 flex-1 truncate">{clue.name}</span>
                                        <Badge variant="outline">{CLUE_STATUS_META[clue.status].label}</Badge>
                                    </div>
                                )
                            })
                        )}
                    </CardContent>
                </Card>

                <Card size="sm" className="gap-0 bg-muted/30">
                    <CardContent className="flex flex-col gap-1.5">
                        <FocusRow
                            label="前情"
                            value={
                                prevChapter === null
                                    ? '本章是卷首，无前情'
                                    : `${chapterTitleLabel(prevChapter)}：${prevChapter.summary || '上一章未填梗概'}`
                            }
                        />
                        <FocusRow
                            label="接下来"
                            value={
                                nextChapter === null
                                    ? '本卷最后一章'
                                    : `${chapterTitleLabel(nextChapter)}：${nextChapter.goal || nextChapter.summary || '下一章未填目标'}`
                            }
                        />
                        <FocusRow label="本卷核心事件" value={volume.coreEvent} />
                        <FocusRow label="卷末结果" value={volume.result} />
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
