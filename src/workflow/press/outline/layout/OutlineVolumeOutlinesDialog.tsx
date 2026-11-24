/**
 * 生成卷纲的预览对话框：按作品设定生成各卷的卷名、预计章节数与卷纲五项，勾选后再写入。
 * 复用约定：弹层取 ui/dialog，勾选取 ui/checkbox，生成状态由 ../hooks/useVolumeOutlinesGenerate 持有
 * （宿主 pressAi/aiVolumeOutlines）。
 * 关键约束：草案不落库，关掉即丢弃；写入只覆盖卷纲字段，章节内容一律不动；
 * 按卷序对齐现有卷（第1个草案覆盖第1卷），多出的草案追加为新卷，现有卷多于草案的保持原样；
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
import type { VolumeOutlineDraft } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import type { CharacterCard, ProjectSetting } from '../../types'
import type { JSX } from 'react'
import { useVolumeOutlinesGenerate } from '../hooks/useVolumeOutlinesGenerate'

/** 期望卷数上限：与宿主侧收窄口径一致 */
const MAX_VOLUME_COUNT = 20

interface OutlineVolumeOutlinesDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    setting: ProjectSetting
    characters: CharacterCard[]
    /** 现有卷名：交给模型避免重名，同时在标题里说明覆盖语义 */
    existingNames: readonly string[]
    /** 覆盖写入：按卷序覆盖现有卷纲，多出的追加为新卷（章节保留），返回写入卷数 */
    onApply: (drafts: readonly VolumeOutlineDraft[]) => number
}

export function OutlineVolumeOutlinesDialog({
    isOpen,
    onOpenChange,
    setting,
    characters,
    existingNames,
    onApply,
}: OutlineVolumeOutlinesDialogProps): JSX.Element {
    const { isGenerating, generate } = useVolumeOutlinesGenerate()
    const [drafts, setDrafts] = useState<VolumeOutlineDraft[]>([])
    const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
    const [volumeCount, setVolumeCount] = useState('')

    const selectedSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes])

    const handleCountChange = (value: string): void => {
        const parsed = Number(value)
        setVolumeCount(
            Number.isFinite(parsed) && parsed > 0 ? String(Math.min(Math.round(parsed), MAX_VOLUME_COUNT)) : '',
        )
    }

    const handleGenerate = useCallback((): void => {
        const parsed = Number(volumeCount)
        const run = async (): Promise<void> => {
            const result = await generate({
                volumeCount: Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), MAX_VOLUME_COUNT) : 0,
                setting,
                characters,
                existingNames,
            })
            if (result === null) {
                return
            }
            setDrafts(result)
            setSelectedIndexes(result.map((_, index) => index))
        }
        void run()
    }, [characters, existingNames, generate, setting, volumeCount])

    const handleToggle = (index: number): void => {
        setSelectedIndexes((previous) =>
            previous.includes(index) ? previous.filter((item) => item !== index) : [...previous, index],
        )
    }

    const handleApply = (): void => {
        const picked = drafts.filter((_, index) => selectedSet.has(index))
        if (picked.length === 0) {
            return
        }
        onApply(picked)
        onOpenChange(false)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="text-lg">生成卷纲</DialogTitle>
                    <DialogDescription>
                        按作品设定规划各卷的核心事件与主要情节，勾选后写入；
                        {existingNames.length > 0
                            ? `现有的 ${String(existingNames.length)} 卷卷纲会按卷序被覆盖，章节内容不受影响`
                            : '作品还没有卷，将直接新建'}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
                    <Field>
                        <FieldLabel htmlFor="outline-volume-outline-count">期望卷数</FieldLabel>
                        <Input
                            id="outline-volume-outline-count"
                            type="number"
                            min={1}
                            max={MAX_VOLUME_COUNT}
                            value={volumeCount}
                            className="tabular-nums"
                            placeholder="留空"
                            onChange={(event) => handleCountChange(event.target.value)}
                        />
                        <FieldDescription>留空即由 AI 按目标字数与故事规模建议</FieldDescription>
                    </Field>
                    <Field className="@md:col-span-2">
                        <FieldLabel>覆盖范围</FieldLabel>
                        <FieldDescription>
                            只覆盖卷纲（卷名、预计章节数、核心事件、主要情节、关键转折、卷末结果）；
                            卷内已写的章节、节拍与场景一律保留
                        </FieldDescription>
                    </Field>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" disabled={isGenerating} onClick={handleGenerate}>
                            <Wand2 />
                            {isGenerating ? '生成中…' : drafts.length > 0 ? '重新生成' : '开始生成'}
                        </Button>
                        {drafts.length > 0 ? (
                            <Badge variant="outline" className="tabular-nums">
                                已选 {selectedSet.size} / {drafts.length} 卷
                            </Badge>
                        ) : null}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
                        {drafts.length === 0 ? (
                            <p className="p-3 text-muted-foreground">
                                {isGenerating
                                    ? '正在按作品设定分卷，需要一点时间…'
                                    : '还没有草案。点「开始生成」，作品设定填得越全，卷纲越贴合。'}
                            </p>
                        ) : (
                            <div className="flex flex-col divide-y divide-border">
                                {drafts.map((draft, index) => (
                                    <label
                                        key={`${String(index)}-${draft.name}`}
                                        className="flex cursor-pointer items-start gap-2 px-2 py-2 hover:bg-muted/30"
                                    >
                                        <Checkbox
                                            checked={selectedSet.has(index)}
                                            className="mt-0.5"
                                            onCheckedChange={() => handleToggle(index)}
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1.5">
                                                <span className="min-w-0 flex-1 truncate font-medium">
                                                    {draft.name}
                                                </span>
                                                <span className="shrink-0 text-muted-foreground tabular-nums">
                                                    {draft.expectedChapters > 0
                                                        ? `约 ${String(draft.expectedChapters)} 章`
                                                        : '章数未定'}
                                                </span>
                                            </span>
                                            <span className="line-clamp-2 text-muted-foreground">
                                                {draft.coreEvent}
                                            </span>
                                            {draft.mainPlot.length > 0 ? (
                                                <span className="line-clamp-1 text-muted-foreground/80">
                                                    主要情节：{draft.mainPlot.join('；')}
                                                </span>
                                            ) : null}
                                        </span>
                                    </label>
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
                        写入卷纲
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
