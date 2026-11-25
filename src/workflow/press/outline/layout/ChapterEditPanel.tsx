/**
 * 章纲编辑面板：以分段表单编辑章纲卡与细纲，改动只经 onChange 回传补丁；卷纲只读区由聚焦面板承载。
 * 复用约定：分段与节拍取同模块 block 组件，字段与选择控件取 @components/ui，字数口径复用 press/utils 的 formatWordCount；
 * 关键约束：场景缺三要素仅提示不阻断；状态与正文字数由写后回填推导，本面板不提供手动设定。
 */
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
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
import type { CharacterCard, OutlineChapter, OutlineScene } from '../../types'
import type { JSX } from 'react'
import { HOOK_OPTIONS, PACING_KIND_OPTIONS, PACING_KIND_ORDER, TENSION_LABELS } from '../../constants'
import { createBeat, createScene, formatWordCount } from '../../utils'
import { OutlineBeatList } from '../block/OutlineBeatList'
import { OutlineSection } from '../block/OutlineSection'

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

/** 单场戏：左侧强调条 + 场景徽标把它和章纲字段区分开，字段名与场景纲的文档键一致 */
function SceneEditor({ scene, index, onChange, onRemove }: SceneEditorProps): JSX.Element {
    return (
        <Card size="sm" className="gap-0 border-l-2 border-chart-4/50">
            <CardContent className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                    <span className="flex h-5 shrink-0 items-center rounded-md bg-chart-4/15 px-1.5 font-medium text-chart-4 tabular-nums">
                        场景{scene.order}
                    </span>
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

interface ChapterEditPanelProps {
    chapter: OutlineChapter
    characters: CharacterCard[]
    onChange: (patch: Partial<OutlineChapter>) => void
}

/** 章纲编辑：章纲与细纲的字段改动统一回传补丁 */
export function ChapterEditPanel({ chapter, characters, onChange }: ChapterEditPanelProps): JSX.Element {
    const progress = chapter.wordGoal > 0 ? Math.min(100, Math.round((chapter.wordCount / chapter.wordGoal) * 100)) : 0
    const selectedCharacters = characters.filter((character) => chapter.characterIds.includes(character.id))
    const tensionLabel = TENSION_LABELS[chapter.tension - 1] ?? ''

    const handleHookChange = (value: string): void => {
        const next = HOOK_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ hook: next })
        }
    }

    const handlePacingChange = (value: string): void => {
        const next = PACING_KIND_ORDER.find((kind) => kind === value)
        if (next !== undefined) {
            onChange({ pacing: next })
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
        <section className="flex flex-col gap-3 p-1">
            <Field>
                <FieldLabel htmlFor="outline-chapter-title" className="sr-only">
                    章名
                </FieldLabel>
                <Input
                    id="outline-chapter-title"
                    value={chapter.title}
                    placeholder="章名"
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

            <Field>
                <FieldLabel htmlFor="outline-chapter-stage">阶段</FieldLabel>
                <Input
                    id="outline-chapter-stage"
                    value={chapter.stage}
                    placeholder="第一阶段：坠楼与觉醒"
                    className="h-7"
                    onChange={(event) => onChange({ stage: event.target.value })}
                />
                <FieldDescription>同一阶段的章共用一个名字，左侧树按它分组；改名需同时改该阶段各章</FieldDescription>
            </Field>

            <div className="flex flex-col gap-2.5">
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

                <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
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

                <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2">
                    <Field>
                        <FieldTitle>本章节奏</FieldTitle>
                        <Select value={chapter.pacing} onValueChange={handlePacingChange}>
                            <SelectTrigger aria-label="本章节奏" className="h-7 w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {PACING_KIND_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
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

                {chapter.actualSummary.length > 0 ? (
                    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-2 py-1.5">
                        <span className="text-muted-foreground">正文事实（回填）</span>
                        <span>{chapter.actualSummary}</span>
                    </div>
                ) : null}
            </div>

            <OutlineSection
                level="scene"
                title="细纲"
                description="节拍与场景：细到当天怎么落笔"
                action={
                    <Button variant="ghost" onClick={handleAddScene}>
                        <Plus />
                        添加场景
                    </Button>
                }
            >
                <div className="flex flex-col gap-1.5">
                    <FieldTitle>节拍</FieldTitle>
                    <OutlineBeatList
                        beats={chapter.beats}
                        onChange={(beats) => onChange({ beats })}
                        onAdd={() => onChange({ beats: [...chapter.beats, createBeat()] })}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <FieldTitle>场景纲（{chapter.scenes.length} 场）</FieldTitle>
                    </div>
                    {chapter.scenes.length === 0 ? (
                        <p className="text-muted-foreground">
                            还没有场景。写细纲时按「谁想要什么 → 遇到什么 → 做了什么选择 → 结果 → 情绪变化」拆成一场场。
                        </p>
                    ) : (
                        <div className="flex flex-col gap-2 @md:pl-3">
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
            </OutlineSection>
        </section>
    )
}
