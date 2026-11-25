/**
 * 章纲编辑对话框：全屏 Dialog 内用「章纲编辑 / 写前查纲」两页签承载单章编辑与写作前核对。
 * 复用约定：对话框取 @webview/components/Dialog，页签取 ui/tabs；表单控件取 field / input / textarea / select / slider，
 * 节拍由 OutlineBeatList 承担，引用行复用 ui/item；聚焦只读区作文件内组件，数据由调用方按当前章传入。
 * 关键约束：卷纲只读、章纲只回传补丁；点生成先切查纲页，确认后才打开会话，返回修改不触发生成；
 * 页头颗粒度只控展示、章内「颗粒度」是档位标记；写后回填由页头菜单独立弹窗承担，本对话框不涉及；
 * 对话框开合由外部 open/onClose 控制，关闭即清生成确认态；场景缺三要素仅提示不阻断。
 */
import { cn } from 'cn'
import {
    ArrowLeft,
    BookMarked,
    ChevronDown,
    ClipboardCheck,
    Globe,
    PenLine,
    Plus,
    ScrollText,
    Trash2,
    Users,
} from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Badge } from '@components/ui/badge'
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
import { Item, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import { Progress } from '@components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Slider } from '@components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import { Dialog } from '@webview/components/Dialog'
import type {
    CharacterCard,
    OutlineChapter,
    OutlineChapterRef,
    OutlineGranularity,
    OutlinePlan,
    OutlineScene,
    OutlineVolume,
    PlanStatus,
    ProjectSetting,
} from '../../types'
import type { JSX } from 'react'
import {
    CLUE_STATUS_META,
    GRANULARITY_OPTIONS,
    GRANULARITY_ORDER,
    HOOK_OPTIONS,
    PACING_KIND_OPTIONS,
    PACING_KIND_ORDER,
    PLAN_STATUS_META,
    TENSION_LABELS,
} from '../../constants'
import { chapterTitleLabel, createBeat, createScene, formatWordCount } from '../../utils'
import { OutlineBeatList } from '../block/OutlineBeatList'
import { OutlineSection } from '../block/OutlineSection'

/** 可切换的四种状态，顺序与徽标元数据一致 */
const STATUS_OPTIONS: readonly PlanStatus[] = ['planned', 'written', 'revise', 'discarded']

interface ReadonlyRowProps {
    label: string
    value: string
    className?: string
}

/** 只读上下文行：卷纲与前后章都是参考信息，不在本页编辑 */
function ReadonlyRow({ label, value, className }: ReadonlyRowProps): JSX.Element {
    return (
        <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
            <span className="text-muted-foreground">{label}</span>
            <span className="line-clamp-2">{value.trim().length > 0 ? value : '未填写'}</span>
        </div>
    )
}

interface ChapterFocusPanelProps {
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

/** 写前查纲：只盯当前章与其前后章关系，三块固定只读区辅助卡文时排查 */
function ChapterFocusPanel({
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

interface ChapterAiPanelProps {
    setting: ProjectSetting
    volume: OutlineVolume
    chapter: OutlineChapter
    characters: CharacterCard[]
    onRequestGenerate: () => void
}

/** AI 副驾：展示本次生成引用的卷、章、人物与设定，动作先转查纲确认，不直接打开会话 */
function ChapterAiPanel({ setting, volume, chapter, characters, onRequestGenerate }: ChapterAiPanelProps): JSX.Element {
    const selectedCharacters = characters.filter((character) => chapter.characterIds.includes(character.id))
    const characterLabel =
        selectedCharacters.length > 0
            ? selectedCharacters.map((character) => character.name).join('、')
            : '未指定出场人物'
    const settingLabel = `${setting.genres.join(' / ') || '未填题材'} · ${setting.tone || '未填风格'}`

    return (
        <div className="flex w-72 shrink-0 flex-col border-l border-border">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                <span className="font-medium">AI 副驾</span>
                <Badge variant="outline">章节生成</Badge>
            </header>
            <div className="flex flex-col gap-2 px-3 py-2">
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">本次引用</span>
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
                </div>
                <p className="leading-relaxed text-muted-foreground">
                    生成时按「作品设定 → 本卷目标 → 本章节拍 → 出场人物 → 上一章结尾」的顺序注入，改动以 diff
                    呈现，可撤销。
                </p>
                <div className="flex flex-col gap-1">
                    <Button className="justify-start" onClick={onRequestGenerate}>
                        <PenLine />
                        生成本章正文
                    </Button>
                    <Button variant="outline" className="justify-start" onClick={onRequestGenerate}>
                        <ScrollText />
                        按大纲续写
                    </Button>
                </div>
            </div>
        </div>
    )
}

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

interface ChapterEditDialogProps {
    /** 对话框开合：由外部选中状态决定 */
    open: boolean
    /** 关闭对话框：只通知外部清选中，不改数据 */
    onClose: () => void
    setting: ProjectSetting
    volume: OutlineVolume
    chapter: OutlineChapter
    chapterRef: OutlineChapterRef
    characters: CharacterCard[]
    plan: OutlinePlan
    /** 同卷上一章，用于「前情」提示 */
    prevChapter: OutlineChapter | null
    /** 同卷下一章，用于聚焦视图的「接下来」提示 */
    nextChapter: OutlineChapter | null
    /** 同卷后续两章，用于编辑页的「接下来」提示 */
    nextChapters: OutlineChapter[]
    onChange: (patch: Partial<OutlineChapter>) => void
    onBack: () => void
    onOpenChat: () => void
    /**
     * 视图颗粒度：粗纲只看梗概与卷纲，中纲加章纲卡与节拍，细纲才展开场景。
     * 关键约束：只影响展示，不改变章纲数据，切视图不产生写盘。
     */
    viewGranularity: OutlineGranularity
}

type ChapterTab = 'edit' | 'focus'

export function ChapterEditDialog({
    open,
    onClose,
    setting,
    volume,
    chapter,
    chapterRef,
    characters,
    plan,
    prevChapter,
    nextChapter,
    nextChapters,
    onChange,
    onBack,
    onOpenChat,
    viewGranularity,
}: ChapterEditDialogProps): JSX.Element {
    const [activeTab, setActiveTab] = useState<ChapterTab>('edit')
    /** 点生成先切查纲页，确认后才真正打开会话 */
    const [isConfirmingGenerate, setIsConfirmingGenerate] = useState(false)

    const progress = chapter.wordGoal > 0 ? Math.min(100, Math.round((chapter.wordCount / chapter.wordGoal) * 100)) : 0
    const selectedCharacters = characters.filter((character) => chapter.characterIds.includes(character.id))
    const tensionLabel = TENSION_LABELS[chapter.tension - 1] ?? ''
    const isCoarse = viewGranularity === 'coarse'
    const isFine = viewGranularity === 'fine'

    /** 生成按钮统一先切查纲页，用户确认后再打开会话 */
    const requestGenerate = (): void => {
        setIsConfirmingGenerate(true)
        setActiveTab('focus')
    }

    /** 查纲页确认：打开会话并清掉待确认标记 */
    const confirmGenerate = (): void => {
        setIsConfirmingGenerate(false)
        onOpenChat()
    }

    /** 查纲页返回编辑：放弃本次生成 */
    const cancelGenerate = (): void => {
        setIsConfirmingGenerate(false)
        setActiveTab('edit')
    }

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
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    setActiveTab('edit')
                    setIsConfirmingGenerate(false)
                    onClose()
                }
            }}
            title={chapterTitleLabel(chapter)}
            description={`第 ${chapter.order} 章 · ${volume.name}`}
            showFooter={false}
            size="full"
        >
            <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as ChapterTab)}
                className="flex h-full flex-col"
            >
                <TabsList className="w-full shrink-0">
                    <TabsTrigger value="edit">章纲编辑</TabsTrigger>
                    <TabsTrigger value="focus">写前查纲</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="flex min-h-0 flex-1 items-stretch gap-3">
                    <section className="flex min-w-0 flex-1 flex-col">
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
                                第 {chapter.order}/{volume.chapters.length} 章
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

                        <div className="flex flex-col gap-3 px-3 py-3">
                            {chapter.status === 'revise' ? (
                                <Alert variant="destructive">
                                    <AlertDescription>
                                        正文可能已偏离最新章纲。核对后回填实际结果，或把状态改回「已写」。
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            <OutlineSection level="volume" title="卷纲" description={`本章所属：${volume.name} · 只读`}>
                                <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                                    <ReadonlyRow label="核心事件" value={volume.coreEvent} className="@md:col-span-2" />
                                    <ReadonlyRow
                                        label="主要情节"
                                        value={volume.mainPlot.join('；')}
                                        className="@md:col-span-2"
                                    />
                                    <ReadonlyRow label="关键转折" value={volume.turningPoints.join('；')} />
                                    <ReadonlyRow label="卷末结果" value={volume.result} />
                                </div>
                                <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5">
                                    <span className="text-muted-foreground">本章在卷内的位置</span>
                                    <ReadonlyRow
                                        label="前情"
                                        value={
                                            prevChapter && prevChapter.summary.length > 0
                                                ? prevChapter.summary
                                                : '本章是卷首，无前情'
                                        }
                                    />
                                    <ReadonlyRow
                                        label="接下来"
                                        value={
                                            nextChapters.length > 0
                                                ? nextChapters.map((item) => item.title).join(' / ')
                                                : '本卷最后一章'
                                        }
                                    />
                                </div>
                            </OutlineSection>

                            <OutlineSection
                                level="chapter"
                                title="章纲"
                                description="章名、梗概与章纲卡：这一章要写什么"
                                action={
                                    <span title="标记本章已细化到哪一档；页头的「视图」只控制显示范围">
                                        <Select value={chapter.granularity} onValueChange={handleGranularityChange}>
                                            <SelectTrigger aria-label="本章颗粒度标记" className="h-6 w-auto">
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
                                    </span>
                                }
                            >
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
                                    <FieldLabel htmlFor="outline-chapter-stage">阶段</FieldLabel>
                                    <Input
                                        id="outline-chapter-stage"
                                        value={chapter.stage}
                                        placeholder="第一阶段：坠楼与觉醒"
                                        className="h-7"
                                        onChange={(event) => onChange({ stage: event.target.value })}
                                    />
                                    <FieldDescription>
                                        同一阶段的章共用一个名字，左侧树按它分组；改名需同时改该阶段各章
                                    </FieldDescription>
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

                                <div className={cn('flex flex-col gap-2.5', isCoarse && 'hidden')}>
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
                                                                ? selectedCharacters
                                                                      .map((character) => character.name)
                                                                      .join('、')
                                                                : characters.length === 0
                                                                  ? '尚未创建人物'
                                                                  : '选择出场人物'}
                                                        </span>
                                                        <ChevronDown
                                                            data-icon="inline-end"
                                                            className="shrink-0 opacity-60"
                                                        />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent
                                                    align="start"
                                                    className="max-h-64 w-56 overflow-y-auto"
                                                >
                                                    <DropdownMenuGroup>
                                                        {characters.map((character) => (
                                                            <DropdownMenuCheckboxItem
                                                                key={character.id}
                                                                checked={chapter.characterIds.includes(character.id)}
                                                                onCheckedChange={() =>
                                                                    handleToggleCharacter(character.id)
                                                                }
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
                                                    {formatWordCount(chapter.wordCount)} /{' '}
                                                    {formatWordCount(chapter.wordGoal)} 字
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
                            </OutlineSection>

                            <OutlineSection
                                level="scene"
                                title="细纲"
                                description="节拍与场景：细到当天怎么落笔"
                                className={cn(isCoarse && 'hidden')}
                                action={
                                    isFine ? (
                                        <Button variant="ghost" onClick={handleAddScene}>
                                            <Plus />
                                            添加场景
                                        </Button>
                                    ) : null
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

                                <div className={cn('flex flex-col gap-2', !isFine && 'hidden')}>
                                    <div className="flex items-center justify-between">
                                        <FieldTitle>场景纲（{chapter.scenes.length} 场）</FieldTitle>
                                    </div>
                                    {chapter.scenes.length === 0 ? (
                                        <p className="text-muted-foreground">
                                            还没有场景。写细纲时按「谁想要什么 → 遇到什么 → 做了什么选择 → 结果 →
                                            情绪变化」拆成一场场。
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

                                {isFine ? null : (
                                    <p className="text-muted-foreground">
                                        当前视图不展开场景纲；把页头的「视图」切到「细纲」即可逐场拆分。
                                    </p>
                                )}
                            </OutlineSection>
                        </div>

                        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                            <Button
                                variant="outline"
                                tooltip="只看本章与其前后章关系，避免边写边想全局"
                                onClick={() => setActiveTab('focus')}
                            >
                                <ClipboardCheck />
                                写前查纲
                            </Button>
                            <span className="flex-1" />
                            <Button onClick={requestGenerate}>
                                <PenLine />
                                生成本章正文
                            </Button>
                        </footer>
                    </section>
                    <ChapterAiPanel
                        setting={setting}
                        volume={volume}
                        chapter={chapter}
                        characters={characters}
                        onRequestGenerate={requestGenerate}
                    />
                </TabsContent>
                <TabsContent value="focus" className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <ChapterFocusPanel
                            volume={volume}
                            chapter={chapter}
                            chapterRef={chapterRef}
                            characters={characters}
                            plan={plan}
                            prevChapter={prevChapter}
                            nextChapter={nextChapter}
                        />
                    </div>
                    {isConfirmingGenerate ? (
                        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                            <span className="flex-1 text-muted-foreground">
                                确认无误后生成正文，会话将带上本章章纲与前后章
                            </span>
                            <Button variant="outline" onClick={cancelGenerate}>
                                返回修改
                            </Button>
                            <Button onClick={confirmGenerate}>
                                <PenLine />
                                确认生成
                            </Button>
                        </footer>
                    ) : (
                        <footer className="flex shrink-0 justify-end border-t border-border px-3 py-2">
                            <Button variant="outline" onClick={() => setActiveTab('edit')}>
                                返回章纲编辑
                            </Button>
                        </footer>
                    )}
                </TabsContent>
            </Tabs>
        </Dialog>
    )
}
