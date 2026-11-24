/**
 * 按卷生成章纲的预览对话框：先按卷纲生成「阶段 / 标题 / 介绍」，勾选后再写入本卷。
 * 复用约定：骨架取业务公共层的 Dialog（取消 / 写入按钮、高度与滚动由它统一提供）；
 * 写入方式与生成按钮合并进 ui/input-group，模式由 ui/switch 切换（关为追加、开为替换空章），
 * 草案预览与勾选取 block/ChapterDraftPreview，
 * 生成状态由 hooks/useVolumeChaptersGenerate 持有（宿主 pressAi/aiVolumeChapters）。
 * 关键约束：草案不落库，关掉即丢弃；写入方式决定起始章序——追加接在卷末，替换空章则跳过未动过的空章；
 * 只有勾选的章会被写入，写入后关闭对话框并由页面提示结果；
 * 调用方须把 key 绑定到打开状态以重建组件，草案与勾选才不会从上一次带过来。
 */
import { Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from '@components/ui/input-group'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import type { VolumeChapterDraft } from '@shared/types/press'
import { Dialog } from '@webview/components/Dialog'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { VolumeChapterWriteMode } from '../../utils'
import type { JSX } from 'react'
import { isEmptyOutlineChapter } from '../../utils'
import { ChapterDraftPreview } from '../block/ChapterDraftPreview'
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
    /** 卸载守卫：异步生成返回后据此跳过已关闭对话框的 setState，effect 内重置兼容 StrictMode 双调用 */
    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])
    const [drafts, setDrafts] = useState<VolumeChapterDraft[]>([])
    const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
    // 写入方式按打开时的卷初始化：调用方用 key 绑定打开状态，每次打开都重建本组件，
    // 因此不需要在 effect 里重置状态，草案与勾选也不会从上一次带过来。
    const [mode, setMode] = useState<VolumeChapterWriteMode>(() =>
        volume !== null && volume.chapters.some((chapter) => isEmptyOutlineChapter(chapter))
            ? 'replace-empty'
            : 'append',
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

    const handleGenerate = useCallback((): void => {
        if (volume === null) {
            return
        }
        const run = async (): Promise<void> => {
            const result = await generate(volume, setting, characters, {
                startOrder: writeRange.startOrder,
                chapterCount: estimateChapterCount(volume),
                existingCount: writeRange.existingCount,
            })
            if (!isMountedRef.current || result === null) {
                return
            }
            setDrafts(result)
            setSelectedIndexes(result.map((_, index) => index))
        }
        void run()
    }, [characters, generate, setting, volume, writeRange])

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
        <Dialog
            open={isOpen}
            title="按卷生成章纲"
            description={
                volume === null
                    ? '先在页头选择一卷'
                    : `以「${volume.name}」的卷纲为骨架，生成阶段、章标题与章节介绍，勾选后写入本卷`
            }
            confirmLabel="写入本卷"
            isDisabled={selectedSet.size === 0}
            className="sm:max-w-3xl"
            onOpenChange={onOpenChange}
            onConfirm={handleApply}
        >
            <Field>
                <FieldLabel htmlFor="outline-volume-write-mode">写入方式</FieldLabel>
                <InputGroup>
                    <InputGroupText className="gap-1.5">
                        <Switch
                            id="outline-volume-write-mode"
                            checked={mode === 'replace-empty'}
                            disabled={volume === null}
                            onCheckedChange={(checked) => setMode(checked ? 'replace-empty' : 'append')}
                        />
                        <Label htmlFor="outline-volume-write-mode" className="font-normal">
                            {mode === 'replace-empty' ? '替换卷内空章' : '追加到卷末'}
                        </Label>
                    </InputGroupText>
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            variant="default"
                            disabled={isGenerating || volume === null}
                            onClick={handleGenerate}
                        >
                            <Wand2 />
                            {isGenerating ? '生成中…' : drafts.length > 0 ? '重新生成' : '开始生成'}
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                    新章从第 {writeRange.startOrder} 章起编号；卷内现有 {writeRange.existingCount} 章。
                    替换空章会把整卷章序重排为 1..N，线索的章序引用会随之前移
                </FieldDescription>
            </Field>

            {drafts.length > 0 ? (
                <div className="flex justify-end">
                    <Badge variant="outline" className="tabular-nums">
                        已选 {selectedSet.size} / {drafts.length} 章
                    </Badge>
                </div>
            ) : null}

            <ChapterDraftPreview
                drafts={drafts}
                selectedSet={selectedSet}
                startOrder={writeRange.startOrder}
                isGenerating={isGenerating}
                onToggle={handleToggle}
                onToggleStage={handleToggleStage}
            />
        </Dialog>
    )
}
