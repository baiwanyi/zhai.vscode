/**
 * 写前查纲：只盯当前这一章与其前后章关系，避免边写边想全局。
 * 复用约定：卡壳时该查的三件事（动机、冲突、结尾新问题）固定成三块只读区；
 * 出场人物取 CharacterCard 的欲望与弱点，相关伏笔取线索表里埋设章或回收章指向本章的条目；
 * 动作按钮沿用 components/Button，返回与回填交回页面处理。
 * 关键约束：本视图只读，不提供任何直接编辑入口——要改章纲回「卷章场景」模块；
 * 只展示与本章相关的线索，不把整张线索表倒进来，否则「聚焦」就失效了。
 */
import { ArrowLeft, ClipboardCheck, RefreshCw } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardContent } from '@components/ui/card'
import { Button } from '@webview/components/Button'
import type { CharacterCard, OutlineChapter, OutlineChapterRef, OutlinePlan, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import { CLUE_STATUS_META, HOOK_OPTIONS, PLAN_STATUS_META, TENSION_LABELS } from '../../constants'
import { chapterTitleLabel } from '../../utils'

interface OutlineFocusViewProps {
    volume: OutlineVolume
    chapter: OutlineChapter
    /** 当前章的「卷序 + 章序」：用于匹配线索表 */
    chapterRef: OutlineChapterRef
    characters: CharacterCard[]
    plan: OutlinePlan
    prevChapter: OutlineChapter | null
    nextChapter: OutlineChapter | null
    onBack: () => void
    onOpenBackfill: () => void
}

/** 一行只读字段：标签固定宽度，内容可换行 */
function FocusRow({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="flex gap-2">
            <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 flex-1">{value.length > 0 ? value : '未填写'}</span>
        </div>
    )
}

export function OutlineFocusView({
    volume,
    chapter,
    chapterRef,
    characters,
    plan,
    prevChapter,
    nextChapter,
    onBack,
    onOpenBackfill,
}: OutlineFocusViewProps): JSX.Element {
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

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="返回章纲" onClick={onBack}>
                    <ArrowLeft />
                </Button>
                <ClipboardCheck className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="shrink-0 font-medium">写前查纲</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {volume.name} · {chapterTitleLabel(chapter)}
                </span>
                <Badge variant="outline">{PLAN_STATUS_META[chapter.status].label}</Badge>
                <Button variant="outline" onClick={onOpenBackfill}>
                    <RefreshCw />
                    写后回填
                </Button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
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
                            <span className="text-muted-foreground">本章没有埋设或回收的线索。</span>
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
