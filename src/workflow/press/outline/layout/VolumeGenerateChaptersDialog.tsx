/**
 * 按卷生成章纲预览对话框：卷纲 + 结构 + 伏笔产出草案，勾选后写入本卷。
 * 复用约定：骨架取 @webview/components/Dialog，草稿列表取 ../block/VolumeChapterDrafts，生成状态取 ../hooks，下拉取 components/OptionSelect。
 * 关键约束：草案不落库；写入方式决定章序范围，切换即清空草案；调用方须用 key 重建组件。
 */
import { Loader2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from '@components/ui/input-group'
import type { OutlineActContext, OutlineClueContext, VolumeChapterDraft } from '@shared/types/press'
import { Badge } from '@webview/blocks/Badge'
import { Dialog } from '@webview/components/Dialog'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { VolumeChapterWriteMode } from '../../utils'
import type { JSX } from 'react'
import { isEmptyOutlineChapter } from '../../utils'
import { VolumeChapterDrafts } from '../block/VolumeChapterDrafts'
import { useVolumeChaptersGenerate } from '../hooks/useVolumeChaptersGenerate'

/** 期望章数的兜底值：卷纲没写章号范围时按三十章起草 */
const FALLBACK_CHAPTER_COUNT = 30
/** 期望章数上限：与宿主侧产出上限一致 */
const MAX_CHAPTER_COUNT = 120
/** 写入方式选项：与 VolumeChapterWriteMode 取值一致 */
const WRITE_MODE_OPTIONS = [
    { value: 'append', label: '追加到卷末' },
    { value: 'replace-empty', label: '替换卷内空章' },
] as const

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

interface VolumeGenerateChaptersDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    volume: OutlineVolume | null
    setting: ProjectSetting
    characters: CharacterCard[]
    /** 全书结构与本卷伏笔：作为生成约束，按当前卷装配 */
    acts: readonly OutlineActContext[]
    clues: readonly OutlineClueContext[]
    /** 写入本卷：返回实际写入的章数（追加与替换空章由 mode 决定） */
    onApply: (drafts: readonly VolumeChapterDraft[], mode: VolumeChapterWriteMode) => number
}

export function VolumeGenerateChaptersDialog({
    isOpen,
    onOpenChange,
    volume,
    setting,
    characters,
    acts,
    clues,
    onApply,
}: VolumeGenerateChaptersDialogProps): JSX.Element {
    const { isGenerating, generate } = useVolumeChaptersGenerate()
    /** 卸载守卫：异步生成返回后据此跳过已关闭对话框的 setState，effect 内重置兼容 StrictMode 双调用 */
    const isMountedRef = useRef(true)
    /** 生成代次：切换写入方式时自增，避免旧请求回来覆盖已清空的新状态 */
    const generationIdRef = useRef(0)
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
        const maxOrder = kept.reduce((max, chapter) => {
            const order = Number.isFinite(chapter.order) ? chapter.order : 0
            return Math.max(max, order)
        }, 0)
        return {
            startOrder: mode === 'replace-empty' ? kept.length + 1 : maxOrder + 1,
            existingCount: kept.length,
        }
    }, [mode, volume])

    const handleGenerate = useCallback((): void => {
        if (volume === null) {
            return
        }
        if (isGenerating) {
            return
        }
        const generationId = ++generationIdRef.current
        const run = async (): Promise<void> => {
            const result = await generate(volume, setting, characters, {
                startOrder: writeRange.startOrder,
                chapterCount: estimateChapterCount(volume),
                existingCount: writeRange.existingCount,
                acts,
                clues,
            })
            if (!isMountedRef.current || result === null || generationId !== generationIdRef.current) {
                return
            }
            setDrafts(result)
            setSelectedIndexes(result.map((_, index) => index))
        }
        void run()
    }, [acts, characters, clues, generate, isGenerating, setting, volume, writeRange])

    const handleToggle = (index: number): void => {
        setSelectedIndexes((previous) =>
            previous.includes(index) ? previous.filter((item) => item !== index) : [...previous, index],
        )
    }

    const handleToggleStage = (indexes: readonly number[]): void => {
        setSelectedIndexes((previous) => {
            const isAllSelected = indexes.every((index) => previous.includes(index))
            return isAllSelected
                ? previous.filter((index) => !indexes.includes(index))
                : [...new Set([...previous, ...indexes])]
        })
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
            size="full"
            open={isOpen}
            title="按卷生成章纲"
            description={volume === null ? '请先选择一卷' : `生成章节草案，勾选后写入「${volume.name}」`}
            confirmLabel="写入本卷"
            isDisabled={selectedSet.size === 0 || isGenerating}
            onOpenChange={onOpenChange}
            onConfirm={handleApply}
        >
            <Card className="min-h-0 flex-1 p-0 ring-0">
                <CardHeader className="items-center px-3">
                    <CardTitle>
                        <InputGroup className="w-fit">
                            <InputGroupAddon align="inline-start">
                                <InputGroupText>写入方式</InputGroupText>
                            </InputGroupAddon>
                            <OptionSelect
                                value={mode}
                                options={WRITE_MODE_OPTIONS}
                                disabled={volume === null}
                                label="写入方式"
                                className="py-1 border-0 bg-transparent dark:bg-transparent dark:hover:bg-transparent data-[size=sm]:rounded-none"
                                size="sm"
                                onChange={(nextMode): void => {
                                    if (nextMode === mode) {
                                        return
                                    }
                                    generationIdRef.current += 1
                                    setMode(nextMode)
                                    setDrafts([])
                                    setSelectedIndexes([])
                                    if (drafts.length > 0 || isGenerating) {
                                        toast.info('写入方式已变更，请重新生成章纲')
                                    }
                                }}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    variant="default"
                                    tooltip={drafts.length > 0 ? '重新生成' : '开始生成'}
                                    disabled={isGenerating || volume === null}
                                    onClick={handleGenerate}
                                >
                                    {isGenerating ? (
                                        <Loader2 className="animate-spin" data-icon="inline-start" />
                                    ) : (
                                        <Wand2 data-icon="inline-start" />
                                    )}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                    </CardTitle>
                    <CardAction className="row-span-1 flex items-center self-center">
                        {drafts.length > 0 ? (
                            <Badge variant="outline" className="tabular-nums">
                                已选 {selectedSet.size} / {drafts.length} 章
                            </Badge>
                        ) : null}
                    </CardAction>
                    <CardDescription className="col-span-2">
                        从第 {writeRange.startOrder} 章起写入，卷内现有 {writeRange.existingCount}{' '}
                        章；替换空章会重排章序与伏笔引用。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col px-0">
                    <VolumeChapterDrafts
                        drafts={drafts}
                        selectedSet={selectedSet}
                        startOrder={writeRange.startOrder}
                        isGenerating={isGenerating}
                        onToggle={handleToggle}
                        onToggleStage={handleToggleStage}
                    />
                </CardContent>
            </Card>
        </Dialog>
    )
}
