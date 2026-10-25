/**
 * 章纲详情：大纲工作台的中间栏，编辑单章的计划梗概、节拍、出场人物与节奏参数。
 * 复用约定：表单控件取自 field / input / textarea / select / slider，人物多选复用 dropdown-menu 的复选项，
 * 节拍编辑由 OutlineBeatList 承担，状态徽标由 OutlineStatusBadge 与状态选择器共同表达。
 * 关键约束：只回传补丁，不复制章纲状态；章名与目标字数改动不触发文件重命名（重命名由章节页负责）；
 * 状态切到「需复核」时仅提示，不自动改写正文，也不阻止继续编辑。
 */
import { ArrowLeft, ChevronDown, PenLine, Wand2 } from 'lucide-react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Card, CardContent } from '@components/ui/card'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Progress } from '@components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Slider } from '@components/ui/slider'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import { OutlineBeatList } from './OutlineBeatList'
import type { CharacterCard, OutlineChapter, OutlineVolume, PlanStatus } from '../types'
import type { JSX } from 'react'
import { HOOK_OPTIONS, PLAN_STATUS_META, TENSION_LABELS } from '../constants'
import { createBeat, formatWordCount } from '../utils'

/** 可切换的四种状态，顺序与徽标元数据一致 */
const STATUS_OPTIONS: readonly PlanStatus[] = ['planned', 'drafting', 'done', 'stale']

interface OutlineDetailProps {
    volume: OutlineVolume
    chapter: OutlineChapter
    characters: CharacterCard[]
    /** 同卷上一章，用于「前情」提示 */
    prevChapter: OutlineChapter | null
    /** 同卷后续两章，用于「接下来」提示 */
    nextChapters: OutlineChapter[]
    onChange: (patch: Partial<OutlineChapter>) => void
    onBack: () => void
    onOpenChat: () => void
    onOpenWizard: () => void
}

export function OutlineDetail({
    volume,
    chapter,
    characters,
    prevChapter,
    nextChapters,
    onChange,
    onBack,
    onOpenChat,
    onOpenWizard,
}: OutlineDetailProps): JSX.Element {
    const progress = chapter.wordGoal > 0 ? Math.min(100, Math.round((chapter.wordCount / chapter.wordGoal) * 100)) : 0
    const selectedCharacters = characters.filter((character) => chapter.characterIds.includes(character.id))
    const tensionLabel = TENSION_LABELS[chapter.tension - 1] ?? ''

    const handleStatusChange = (value: string): void => {
        const next = STATUS_OPTIONS.find((status) => status === value)
        if (next) {
            onChange({ status: next })
        }
    }

    const handleHookChange = (value: string): void => {
        const next = HOOK_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ hook: next })
        }
    }

    const handleToggleCharacter = (characterId: string): void => {
        onChange({
            characterIds: chapter.characterIds.includes(characterId)
                ? chapter.characterIds.filter((id) => id !== characterId)
                : [...chapter.characterIds, characterId],
        })
    }

    const handleWordGoalChange = (value: string): void => {
        const parsed = Number(value)
        onChange({ wordGoal: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0 })
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full @2xl:hidden"
                    aria-label="返回大纲树"
                    onClick={onBack}
                >
                    <ArrowLeft />
                </Button>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{volume.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                    {chapter.order}/{volume.chapters.length}
                </span>
                <Select value={chapter.status} onValueChange={handleStatusChange}>
                    <SelectTrigger aria-label="章纲状态" className="h-6 w-auto">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {STATUS_OPTIONS.map((status) => (
                                <SelectItem key={status} value={status}>
                                    {PLAN_STATUS_META[status].label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
                {chapter.status === 'stale' ? (
                    <Alert variant="destructive">
                        <AlertDescription>
                            大纲已变更，本章正文可能未兑现最新节拍。复核后可继续写作或标记完成。
                        </AlertDescription>
                    </Alert>
                ) : null}

                <Field>
                    <FieldLabel htmlFor="outline-chapter-title" className="sr-only">
                        章名
                    </FieldLabel>
                    <Input
                        id="outline-chapter-title"
                        value={chapter.title}
                        placeholder="第N章 章名"
                        className="h-8 border-transparent bg-transparent px-0 font-heading font-semibold shadow-none focus-visible:border-input focus-visible:px-2"
                        onChange={(event) => onChange({ title: event.target.value })}
                    />
                </Field>

                <Field>
                    <FieldLabel htmlFor="outline-chapter-summary">计划梗概</FieldLabel>
                    <Textarea
                        id="outline-chapter-summary"
                        value={chapter.summary}
                        placeholder="这一章打算写什么：目标、阻碍、结果、留下的钩子"
                        className="min-h-16"
                        maxLength={200}
                        onChange={(event) => onChange({ summary: event.target.value })}
                    />
                    <FieldDescription className="tabular-nums">
                        还可输入 {200 - chapter.summary.length} 字，计划与实际摘要分开记录
                    </FieldDescription>
                </Field>

                <div className="flex flex-col gap-1.5">
                    <FieldTitle>节拍</FieldTitle>
                    <OutlineBeatList
                        beats={chapter.beats}
                        onChange={(beats) => onChange({ beats })}
                        onAdd={() => onChange({ beats: [...chapter.beats, createBeat()] })}
                    />
                </div>

                <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                    <Field>
                        <FieldTitle>出场人物</FieldTitle>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    aria-label="选择出场人物"
                                    variant="outline"
                                    className="h-7 w-full justify-between px-2 font-normal"
                                    disabled={characters.length === 0}
                                >
                                    <span className="min-w-0 truncate">
                                        {selectedCharacters.length > 0
                                            ? selectedCharacters.map((character) => character.name).join('、')
                                            : characters.length === 0
                                              ? '尚未创建人物'
                                              : '选择出场人物'}
                                    </span>
                                    <ChevronDown data-icon="inline-end" className="shrink-0 opacity-60" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
                                <DropdownMenuGroup>
                                    {characters.map((character) => (
                                        <DropdownMenuCheckboxItem
                                            key={character.id}
                                            checked={chapter.characterIds.includes(character.id)}
                                            onCheckedChange={() => handleToggleCharacter(character.id)}
                                        >
                                            {character.name}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="outline-chapter-location">场景地点</FieldLabel>
                        <Input
                            id="outline-chapter-location"
                            value={chapter.location}
                            placeholder="本章主要发生地"
                            className="h-7"
                            onChange={(event) => onChange({ location: event.target.value })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="outline-chapter-hook">章末钩子</FieldLabel>
                        <Select value={chapter.hook} onValueChange={handleHookChange}>
                            <SelectTrigger id="outline-chapter-hook" className="h-7 w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {HOOK_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="outline-chapter-word-goal">目标字数</FieldLabel>
                        <Input
                            id="outline-chapter-word-goal"
                            type="number"
                            min={0}
                            step={500}
                            value={chapter.wordGoal > 0 ? chapter.wordGoal : ''}
                            className="h-7 tabular-nums"
                            onChange={(event) => handleWordGoalChange(event.target.value)}
                        />
                    </Field>
                </div>

                <Field>
                    <FieldTitle>本章张力</FieldTitle>
                    <div className="flex items-center gap-2">
                        <Slider
                            value={[chapter.tension]}
                            min={1}
                            max={5}
                            step={1}
                            aria-label="本章张力"
                            className="flex-1"
                            onValueChange={(values) => {
                                const next = values[0]
                                if (typeof next === 'number') {
                                    onChange({ tension: next })
                                }
                            }}
                        />
                        <span className="w-12 shrink-0 text-right text-muted-foreground">
                            {chapter.tension} {tensionLabel}
                        </span>
                    </div>
                </Field>

                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                        <span>正文进度</span>
                        <span className="tabular-nums">
                            {formatWordCount(chapter.wordCount)} / {formatWordCount(chapter.wordGoal)} 字
                        </span>
                    </div>
                    <Progress value={progress} aria-label={`正文进度 ${progress}%`} />
                </div>

                <Card size="sm" className="gap-0 bg-muted/30">
                    <CardContent className="flex flex-col gap-1.5">
                        <div className="flex gap-1.5">
                            <span className="shrink-0 text-muted-foreground">本卷目标</span>
                            <span className="line-clamp-2 min-w-0 flex-1">
                                {volume.goal.length > 0 ? volume.goal : '未填写'}
                            </span>
                        </div>
                        {/* 情节脉络与关键转折来自导入归纳的卷纲：没有内容时不占位，避免每章重复三行「未填写」 */}
                        {volume.plotline.length > 0 ? (
                            <div className="flex gap-1.5">
                                <span className="shrink-0 text-muted-foreground">情节脉络</span>
                                <span className="line-clamp-3 min-w-0 flex-1">{volume.plotline}</span>
                            </div>
                        ) : null}
                        {volume.turningPoints.length > 0 ? (
                            <div className="flex gap-1.5">
                                <span className="shrink-0 text-muted-foreground">关键转折</span>
                                <span className="line-clamp-2 min-w-0 flex-1">{volume.turningPoints.join('；')}</span>
                            </div>
                        ) : null}
                        <div className="flex gap-1.5">
                            <span className="shrink-0 text-muted-foreground">前情</span>
                            <span className="line-clamp-2 min-w-0 flex-1">
                                {prevChapter && prevChapter.summary.length > 0
                                    ? prevChapter.summary
                                    : '本章是卷首，无前情'}
                            </span>
                        </div>
                        <div className="flex gap-1.5">
                            <span className="shrink-0 text-muted-foreground">接下来</span>
                            <span className="line-clamp-2 min-w-0 flex-1">
                                {nextChapters.length > 0
                                    ? nextChapters.map((item) => item.title).join(' / ')
                                    : '本卷最后一章'}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
                <Button variant="ghost" onClick={onOpenWizard}>
                    <Wand2 />
                    重写本章纲
                </Button>
                <span className="flex-1" />
                <Button onClick={onOpenChat}>
                    <PenLine />
                    生成本章正文
                </Button>
            </footer>
        </div>
    )
}
