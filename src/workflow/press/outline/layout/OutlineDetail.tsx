/**
 * 章纲详情：大纲工作台的中间栏，编辑一章的章纲卡与场景纲。
 * 复用约定：表单控件取自 field / input / textarea / select / slider，人物多选复用 dropdown-menu 的复选项，
 * 节拍编辑由 OutlineBeatList 承担，状态徽标由 PLAN_STATUS_META 与状态选择器共同表达；
 * 场景纲以五级结构挂在章下，字段固定为欲望 / 阻碍 / 选择 / 结果 / 情绪变化。
 * 关键约束：只回传补丁，不复制章纲状态；summary 是计划、actualSummary 是正文事实，后者只读展示；
 * 场景没有目标、阻碍与变化时只提示不阻断——是否删掉这场戏由作者判断；
 * 「写前查纲」与「写后回填」只把动作交回页面，本组件不直接读章节文件。
 */
import { cn } from 'cn'
import { ArrowLeft, ChevronDown, ClipboardCheck, PenLine, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react'
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
import type {
    CharacterCard,
    OutlineChapter,
    OutlineGranularity,
    OutlineScene,
    OutlineVolume,
    PlanStatus,
} from '../../types'
import type { JSX } from 'react'
import { GRANULARITY_OPTIONS, GRANULARITY_ORDER, HOOK_OPTIONS, PLAN_STATUS_META, TENSION_LABELS } from '../../constants'
import { createBeat, createScene, formatWordCount } from '../../utils'

/** 可切换的四种状态，顺序与徽标元数据一致 */
const STATUS_OPTIONS: readonly PlanStatus[] = ['planned', 'written', 'revise', 'discarded']

/** 判断一场戏是否缺少最小结构：没有欲望、阻碍或变化时给出提示 */
function isSceneIncomplete(scene: OutlineScene): boolean {
    return (
        scene.desire.trim().length === 0 ||
        scene.obstacle.trim().length === 0 ||
        (scene.result.trim().length === 0 && scene.emotion.trim().length === 0)
    )
}

interface SceneEditorProps {
    scene: OutlineScene
    index: number
    onChange: (patch: Partial<OutlineScene>) => void
    onRemove: () => void
}

/** 单场戏：五个字段 + 删除，字段名与场景纲的文档键一致 */
function SceneEditor({ scene, index, onChange, onRemove }: SceneEditorProps): JSX.Element {
    return (
        <Card size="sm" className="gap-0">
            <CardContent className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-muted-foreground tabular-nums">场景{scene.order}</span>
                    <Input
                        value={scene.title}
                        aria-label={`第 ${index + 1} 场戏标题`}
                        placeholder="这场戏发生在哪里、谁在场"
                        className="h-7 font-medium"
                        onChange={(event) => onChange({ title: event.target.value })}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 rounded-full"
                        aria-label={`删除第 ${index + 1} 场戏`}
                        onClick={onRemove}
                    >
                        <Trash2 />
                    </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`scene-desire-${scene.id}`} className="text-muted-foreground">
                            欲望：谁想要什么
                        </label>
                        <Input
                            id={`scene-desire-${scene.id}`}
                            value={scene.desire}
                            className="h-7"
                            onChange={(event) => onChange({ desire: event.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`scene-obstacle-${scene.id}`} className="text-muted-foreground">
                            阻碍：谁 / 什么阻止
                        </label>
                        <Input
                            id={`scene-obstacle-${scene.id}`}
                            value={scene.obstacle}
                            className="h-7"
                            onChange={(event) => onChange({ obstacle: event.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`scene-choice-${scene.id}`} className="text-muted-foreground">
                            选择：他做了什么
                        </label>
                        <Input
                            id={`scene-choice-${scene.id}`}
                            value={scene.choice}
                            className="h-7"
                            onChange={(event) => onChange({ choice: event.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`scene-result-${scene.id}`} className="text-muted-foreground">
                            结果：达成 / 失败 / 代价
                        </label>
                        <Input
                            id={`scene-result-${scene.id}`}
                            value={scene.result}
                            className="h-7"
                            onChange={(event) => onChange({ result: event.target.value })}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor={`scene-emotion-${scene.id}`} className="text-muted-foreground">
                        情绪变化：从什么到什么
                    </label>
                    <Input
                        id={`scene-emotion-${scene.id}`}
                        value={scene.emotion}
                        className="h-7"
                        onChange={(event) => onChange({ emotion: event.target.value })}
                    />
                </div>
                {isSceneIncomplete(scene) ? (
                    <p className="text-muted-foreground">没有欲望、阻碍与变化：这场戏可以考虑删掉或与相邻场景合并。</p>
                ) : null}
            </CardContent>
        </Card>
    )
}

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
    /** 打开单章聚焦的「写前查纲」 */
    onOpenFocus: () => void
    /** 打开「写后回填」差异对比 */
    onOpenBackfill: () => void
    /**
     * 视图颗粒度：粗纲只看梗概与卷目标，中纲加章纲卡与节拍，细纲才展开场景。
     * 关键约束：只影响展示，不改变章纲数据，切视图不产生写盘。
     */
    viewGranularity: OutlineGranularity
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
    onOpenFocus,
    onOpenBackfill,
    viewGranularity,
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

    const handleGranularityChange = (value: string): void => {
        const next = GRANULARITY_ORDER.find((granularity) => granularity === value)
        if (next !== undefined) {
            onChange({ granularity: next })
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

    const handleAddScene = (): void => {
        const nextOrder = chapter.scenes.reduce((max, scene) => Math.max(max, scene.order), 0) + 1
        onChange({ scenes: [...chapter.scenes, createScene(nextOrder)] })
    }

    const handleScenePatch = (sceneId: string, patch: Partial<OutlineScene>): void => {
        onChange({
            scenes: chapter.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
        })
    }

    const handleRemoveScene = (sceneId: string): void => {
        onChange({ scenes: chapter.scenes.filter((scene) => scene.id !== sceneId) })
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
                <Select value={chapter.granularity} onValueChange={handleGranularityChange}>
                    <SelectTrigger aria-label="章纲颗粒度" className="h-6 w-auto">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {GRANULARITY_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
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
                {chapter.status === 'revise' ? (
                    <Alert variant="destructive">
                        <AlertDescription>
                            正文可能已偏离最新章纲。核对后回填实际结果，或把状态改回「已写」。
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

                <div className={cn('flex flex-col gap-3', viewGranularity === 'coarse' && 'hidden')}>
                    <FieldTitle>章纲卡</FieldTitle>
                    <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="outline-chapter-pov">POV</FieldLabel>
                            <Input
                                id="outline-chapter-pov"
                                value={chapter.pov}
                                placeholder="本章由谁的视角看"
                                className="h-7"
                                onChange={(event) => onChange({ pov: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="outline-chapter-goal">目标</FieldLabel>
                            <Input
                                id="outline-chapter-goal"
                                value={chapter.goal}
                                placeholder="他此刻想得到什么"
                                className="h-7"
                                onChange={(event) => onChange({ goal: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="outline-chapter-obstacle">阻碍</FieldLabel>
                            <Input
                                id="outline-chapter-obstacle"
                                value={chapter.obstacle}
                                placeholder="谁 / 什么阻止他"
                                className="h-7"
                                onChange={(event) => onChange({ obstacle: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="outline-chapter-turn">转折</FieldLabel>
                            <Input
                                id="outline-chapter-turn"
                                value={chapter.turn}
                                placeholder="意料之外但合理的变化"
                                className="h-7"
                                onChange={(event) => onChange({ turn: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="outline-chapter-result">结果</FieldLabel>
                            <Input
                                id="outline-chapter-result"
                                value={chapter.result}
                                placeholder="达成 / 失败 / 代价"
                                className="h-7"
                                onChange={(event) => onChange({ result: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="outline-chapter-emotion">情绪</FieldLabel>
                            <Input
                                id="outline-chapter-emotion"
                                value={chapter.emotion}
                                placeholder="紧张 / 爽 / 疑 / 悲"
                                className="h-7"
                                onChange={(event) => onChange({ emotion: event.target.value })}
                            />
                        </Field>
                    </div>

                    {chapter.actualSummary.length > 0 ? (
                        <Card size="sm" className="gap-0 bg-muted/30">
                            <CardContent className="flex flex-col gap-1">
                                <span className="text-muted-foreground">正文事实（回填）</span>
                                <span>{chapter.actualSummary}</span>
                            </CardContent>
                        </Card>
                    ) : null}

                    <div className="flex flex-col gap-1.5">
                        <FieldTitle>节拍</FieldTitle>
                        <OutlineBeatList
                            beats={chapter.beats}
                            onChange={(beats) => onChange({ beats })}
                            onAdd={() => onChange({ beats: [...chapter.beats, createBeat()] })}
                        />
                    </div>

                    <div className={cn('flex flex-col gap-2', viewGranularity !== 'fine' && 'hidden')}>
                        <div className="flex items-center justify-between">
                            <FieldTitle>场景纲</FieldTitle>
                            <Button variant="ghost" onClick={handleAddScene}>
                                <Plus />
                                添加场景
                            </Button>
                        </div>
                        {chapter.scenes.length === 0 ? (
                            <p className="text-muted-foreground">
                                还没有场景。写细纲时按「谁想要什么 → 遇到什么 → 做了什么选择 → 结果 →
                                情绪变化」拆成一场场。
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {chapter.scenes.map((scene, index) => (
                                    <SceneEditor
                                        key={scene.id}
                                        scene={scene}
                                        index={index}
                                        onChange={(patch) => handleScenePatch(scene.id, patch)}
                                        onRemove={() => handleRemoveScene(scene.id)}
                                    />
                                ))}
                            </div>
                        )}
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
                </div>

                <Card size="sm" className="gap-0 bg-muted/30">
                    <CardContent className="flex flex-col gap-1.5">
                        <div className="flex gap-1.5">
                            <span className="shrink-0 text-muted-foreground">本卷目标</span>
                            <span className="line-clamp-2 min-w-0 flex-1">
                                {volume.goal.length > 0 ? volume.goal : '未填写'}
                            </span>
                        </div>
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
                        {volume.result.length > 0 ? (
                            <div className="flex gap-1.5">
                                <span className="shrink-0 text-muted-foreground">卷末结果</span>
                                <span className="line-clamp-2 min-w-0 flex-1">{volume.result}</span>
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

            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                <Button variant="outline" tooltip="只看本章与其前后章关系，避免边写边想全局" onClick={onOpenFocus}>
                    <ClipboardCheck />
                    写前查纲
                </Button>
                <Button variant="outline" tooltip="正文写完后，把实际结果回填到章纲与线索表" onClick={onOpenBackfill}>
                    <RefreshCw />
                    写后回填
                </Button>
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
