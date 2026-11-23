/**
 * 按卷生成章纲的预览对话框：先按卷纲生成「阶段 / 标题 / 介绍」，勾选后再写入本卷。
 * 复用约定：弹层取 ui/dialog，勾选与整行点击取 ui/checkbox + Button，阶段分组复用 utils 的 groupChaptersByStage，
 * 生成状态由同目录 hooks/useVolumeChaptersGenerate 持有（宿主 pressAi/aiVolumeChapters）。
 * 关键约束：草案不落库，关掉即丢弃；写入方式决定起始章序——追加接在卷末，替换空章则跳过未动过的空章；
 * 只有勾选的章会被写入，写入后关闭对话框并由页面提示结果；
 * 调用方须把 key 绑定到打开状态以重建组件，草案与勾选才不会从上一次带过来。
 */
import { Wand2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Checkbox } from '@components/ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { VolumeChapterDraft } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { VolumeChapterWriteMode } from '../../utils'
import type { JSX } from 'react'
import { isEmptyOutlineChapter } from '../../utils'
import { useVolumeChaptersGenerate } from '../hooks/useVolumeChaptersGenerate'

/** 期望章数的兜底值：卷纲没写章号范围时按三十章起草 */
const FALLBACK_CHAPTER_COUNT = 30
/** 期望章数上限：与宿主侧产出上限一致 */
const MAX_CHAPTER_COUNT = 120

/** 期望章数：优先取卷纲填的「预计章节数」，否则从核心事件与主要情节里推断最大的章号 */
function estimateChapterCount(volume: OutlineVolume): number {
    if (volume.expectedChapters > 0) {
        return Math.min(volume.expectedChapters, MAX_CHAPTER_COUNT)
    }
    const text = [volume.coreEvent, ...volume.mainPlot].join('\n')
    const ranges = [...text.matchAll(/第\s*\d+\s*[-—－~至]\s*(\d+)\s*章/gu)].map((match) =>
        Number.parseInt(match[1] ?? '', 10),
    )
    const singles = [...text.matchAll(/第\s*(\d+)\s*章/gu)].map((match) => Number.parseInt(match[1] ?? '', 10))
    const orders = [...ranges, ...singles].filter((order) => Number.isFinite(order) && order > 0)
    return orders.length > 0 ? Math.min(Math.max(...orders), MAX_CHAPTER_COUNT) : FALLBACK_CHAPTER_COUNT
}

interface OutlineVolumeChaptersDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    volume: OutlineVolume | null
    setting: ProjectSetting
    characters: CharacterCard[]
    /** 写入本卷：返回实际写入的章数（追加与替换空章由 mode 决定） */
    onApply: (drafts: readonly VolumeChapterDraft[], mode: VolumeChapterWriteMode) => number
}

export function OutlineVolumeChaptersDialog({
    isOpen,
    onOpenChange,
    volume,
    setting,
    characters,
    onApply,
}: OutlineVolumeChaptersDialogProps): JSX.Element {
    const { isGenerating, generate } = useVolumeChaptersGenerate()
    const [drafts, setDrafts] = useState<VolumeChapterDraft[]>([])
    const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
    // 写入方式与章数按打开时的卷初始化：调用方用 key 绑定打开状态，每次打开都重建本组件，
    // 因此不需要在 effect 里重置状态，草案与勾选也不会从上一次带过来。
    const [mode, setMode] = useState<VolumeChapterWriteMode>(() =>
        volume !== null && volume.chapters.some((chapter) => isEmptyOutlineChapter(chapter))
            ? 'replace-empty'
            : 'append',
    )
    const [chapterCount, setChapterCount] = useState(() =>
        volume === null ? String(FALLBACK_CHAPTER_COUNT) : String(estimateChapterCount(volume)),
    )

    const selectedSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes])

    /**
     * 写入范围：追加接在卷末最大章序之后；替换空章会整卷重排，起始章序取「保留章数 + 1」，
     * 与写入后 renumber 的实际章序一致，预览里的「第N章」才不会与实际落盘错位。
     */
    const writeRange = useMemo(() => {
        if (volume === null) {
            return { startOrder: 1, existingCount: 0 }
        }
        const kept =
            mode === 'replace-empty'
                ? volume.chapters.filter((chapter) => !isEmptyOutlineChapter(chapter))
                : volume.chapters
        const maxOrder = kept.reduce((max, chapter) => Math.max(max, chapter.order), 0)
        return {
            startOrder: mode === 'replace-empty' ? kept.length + 1 : maxOrder + 1,
            existingCount: kept.length,
        }
    }, [mode, volume])

    /** 预览分组：按草案的阶段切片，组序沿用生成顺序 */
    const previewGroups = useMemo(() => groupDraftsByStage(drafts), [drafts])

    const handleCountChange = (value: string): void => {
        const parsed = Number(value)
        setChapterCount(
            Number.isFinite(parsed) && parsed > 0 ? String(Math.min(Math.round(parsed), MAX_CHAPTER_COUNT)) : '',
        )
    }

    const handleGenerate = useCallback((): void => {
        if (volume === null) {
            return
        }
        const parsed = Number(chapterCount)
        const run = async (): Promise<void> => {
            const result = await generate(volume, setting, characters, {
                startOrder: writeRange.startOrder,
                chapterCount:
                    Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), MAX_CHAPTER_COUNT) : 0,
                existingCount: writeRange.existingCount,
            })
            if (result === null) {
                return
            }
            setDrafts(result)
            setSelectedIndexes(result.map((_, index) => index))
        }
        void run()
    }, [chapterCount, characters, generate, setting, volume, writeRange])

    const handleToggle = (index: number): void => {
        setSelectedIndexes((previous) =>
            previous.includes(index) ? previous.filter((item) => item !== index) : [...previous, index],
        )
    }

    const handleToggleStage = (indexes: readonly number[]): void => {
        const isAllSelected = indexes.every((index) => selectedSet.has(index))
        setSelectedIndexes((previous) =>
            isAllSelected
                ? previous.filter((index) => !indexes.includes(index))
                : [...new Set([...previous, ...indexes])],
        )
    }

    const handleApply = (): void => {
        const picked = drafts.filter((_, index) => selectedSet.has(index))
        if (picked.length === 0) {
            return
        }
        onApply(picked, mode)
        onOpenChange(false)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="text-lg">按卷生成章纲</DialogTitle>
                    <DialogDescription>
                        {volume === null
                            ? '先在页头选择一卷'
                            : `以「${volume.name}」的卷纲为骨架，生成阶段、章标题与章节介绍，勾选后写入本卷`}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
                    <Field>
                        <FieldLabel htmlFor="outline-volume-chapter-count">期望章数</FieldLabel>
                        <Input
                            id="outline-volume-chapter-count"
                            type="number"
                            min={1}
                            max={MAX_CHAPTER_COUNT}
                            value={chapterCount}
                            className="tabular-nums"
                            onChange={(event) => handleCountChange(event.target.value)}
                        />
                        <FieldDescription>留空即按卷纲自行推断</FieldDescription>
                    </Field>
                    <Field className="@md:col-span-2">
                        <FieldLabel htmlFor="outline-volume-write-mode">写入方式</FieldLabel>
                        <Select
                            value={mode}
                            onValueChange={(value) => setMode(value === 'replace-empty' ? 'replace-empty' : 'append')}
                        >
                            <SelectTrigger id="outline-volume-write-mode" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="append">追加到卷末（保留现有全部章节）</SelectItem>
                                    <SelectItem value="replace-empty">替换卷内空章（待写、无梗概的章）</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <FieldDescription>
                            新章从第 {writeRange.startOrder} 章起编号；卷内现有 {writeRange.existingCount} 章。
                            替换空章会把整卷章序重排为 1..N，线索的章序引用会随之前移
                        </FieldDescription>
                    </Field>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" disabled={isGenerating || volume === null} onClick={handleGenerate}>
                            <Wand2 />
                            {isGenerating ? '生成中…' : drafts.length > 0 ? '重新生成' : '开始生成'}
                        </Button>
                        {drafts.length > 0 ? (
                            <Badge variant="outline" className="tabular-nums">
                                已选 {selectedSet.size} / {drafts.length} 章
                            </Badge>
                        ) : null}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
                        {drafts.length === 0 ? (
                            <p className="p-3 text-muted-foreground">
                                {isGenerating
                                    ? '正在按卷纲拆章，整卷生成需要一点时间…'
                                    : '还没有草案。先补全卷纲的「主要情节」，再点「开始生成」。'}
                            </p>
                        ) : (
                            <div className="flex flex-col divide-y divide-border">
                                {previewGroups.map((group) => (
                                    <section
                                        key={group.stage.length > 0 ? group.stage : '__ungrouped'}
                                        className="flex flex-col"
                                    >
                                        <div className="flex items-center gap-2 bg-muted/40 px-2 py-1">
                                            <button
                                                type="button"
                                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                                onClick={() => handleToggleStage(group.indexes)}
                                            >
                                                <span className="min-w-0 flex-1 truncate font-medium">
                                                    {group.stage.length > 0 ? group.stage : '未分组'}
                                                </span>
                                                <span className="shrink-0 text-muted-foreground tabular-nums">
                                                    {group.indexes.length} 章
                                                </span>
                                            </button>
                                        </div>
                                        {group.indexes.map((index) => {
                                            const draft = drafts[index]
                                            if (draft === undefined) {
                                                return null
                                            }
                                            return (
                                                <label
                                                    key={`${String(index)}-${draft.title}`}
                                                    className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-muted/30"
                                                >
                                                    <Checkbox
                                                        checked={selectedSet.has(index)}
                                                        className="mt-0.5"
                                                        onCheckedChange={() => handleToggle(index)}
                                                    />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex items-center gap-1.5">
                                                            <span className="shrink-0 text-muted-foreground tabular-nums">
                                                                第 {writeRange.startOrder + index} 章
                                                            </span>
                                                            <span className="min-w-0 flex-1 truncate font-medium">
                                                                {draft.title}
                                                            </span>
                                                        </span>
                                                        <span className="line-clamp-2 text-muted-foreground">
                                                            {draft.summary}
                                                        </span>
                                                    </span>
                                                </label>
                                            )
                                        })}
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="items-center gap-2">
                    <span className="flex-1" />
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button disabled={selectedSet.size === 0} onClick={handleApply}>
                        写入本卷
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** 预览分组：按草案的阶段名切片，保留首次出现的组序与组内顺序 */
function groupDraftsByStage(drafts: readonly VolumeChapterDraft[]): {
    stage: string
    indexes: number[]
}[] {
    const groups = new Map<string, number[]>()
    drafts.forEach((draft, index) => {
        const stage = draft.stage.trim()
        const bucket = groups.get(stage)
        if (bucket === undefined) {
            groups.set(stage, [index])
        } else {
            bucket.push(index)
        }
    })
    return [...groups].map(([stage, indexes]) => ({ stage, indexes }))
}
