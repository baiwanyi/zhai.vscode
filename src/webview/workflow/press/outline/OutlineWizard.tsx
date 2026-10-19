/**
 * 生成大纲向导：三步完成「确认输入 → 预览卷纲 → 勾选章纲并写入」，是流程第四步的入口。
 * 复用约定：弹层复用 ui/dialog，步骤内容分别由 OutlineWizardInput、OutlineWizardPlan 承担，
 * 草案由 utils 的 buildOutlineDraft 按结构模板推导，本文件只负责步骤流转与最终装配。
 * 关键约束：草案只在本次打开期间存在，调用方须把 key 绑定到打开状态以重建组件，
 * 否则上一次的草案会被误写入当前作品；写入前必须按剩余章节重新编号，避免删除中间章后出现序号空洞。
 */
import { cn } from 'cn'
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { OutlineWizardInput } from './OutlineWizardInput'
import { OutlineWizardPlan } from './OutlineWizardPlan'
import type { CharacterCard, OutlineVolume, ProjectSetting, WizardStep } from '../types'
import type { OutlineDraftOptions } from '../utils'
import type { JSX } from 'react'
import { buildOutlineDraft } from '../utils'

/** 步骤顺序：与向导顶部的指示器一致 */
const WIZARD_STEPS: readonly { id: WizardStep; label: string }[] = [
    { id: 'input', label: '输入确认' },
    { id: 'volume', label: '卷纲' },
    { id: 'chapter', label: '章纲' },
]

interface OutlineWizardProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    setting: ProjectSetting
    characters: CharacterCard[]
    /** 已存在的章节数，用于在写入前提示合并行为 */
    existingChapterCount: number
    defaultChapterWordGoal: number
    onApply: (volumes: OutlineVolume[]) => void
}

export function OutlineWizard({
    isOpen,
    onOpenChange,
    setting,
    characters,
    existingChapterCount,
    defaultChapterWordGoal,
    onApply,
}: OutlineWizardProps): JSX.Element {
    const [step, setStep] = useState<WizardStep>('input')
    const [options, setOptions] = useState<OutlineDraftOptions>({
        volumeCount: 3,
        chaptersPerVolume: 10,
        chapterWordGoal: defaultChapterWordGoal,
        pacing: 'steady',
        structure: '三幕式',
    })
    const [draft, setDraft] = useState<OutlineVolume[]>([])
    const [selectedIds, setSelectedIds] = useState<string[]>([])

    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
    const selectedCount = useMemo(
        () => draft.reduce((count, volume) => count + volume.chapters.filter((chapter) => selectedSet.has(chapter.id)).length, 0),
        [draft, selectedSet],
    )

    const handleOptionsChange = (patch: Partial<OutlineDraftOptions>): void => {
        setOptions((previous) => ({ ...previous, ...patch }))
    }

    const handleBuild = (): void => {
        const next = buildOutlineDraft(setting, characters, options)
        setDraft(next)
        setSelectedIds(next.flatMap((volume) => volume.chapters.map((chapter) => chapter.id)))
        setStep('volume')
    }

    const handleToggleChapter = (chapterId: string): void => {
        setSelectedIds((previous) =>
            previous.includes(chapterId) ? previous.filter((id) => id !== chapterId) : [...previous, chapterId],
        )
    }

    const handleToggleVolume = (volumeId: string): void => {
        const volume = draft.find((item) => item.id === volumeId)
        if (!volume) {
            return
        }
        const volumeIds = volume.chapters.map((chapter) => chapter.id)
        const isAllSelected = volumeIds.every((id) => selectedSet.has(id))
        setSelectedIds((previous) =>
            isAllSelected
                ? previous.filter((id) => !volumeIds.includes(id))
                : [...new Set([...previous, ...volumeIds])],
        )
    }

    const handleApply = (): void => {
        const next = draft
            .map((volume) => ({
                ...volume,
                chapters: volume.chapters
                    .filter((chapter) => selectedSet.has(chapter.id))
                    .map((chapter, index) => ({ ...chapter, order: index + 1 })),
            }))
            .filter((volume) => volume.chapters.length > 0)
        if (next.length === 0) {
            return
        }
        onApply(next)
        onOpenChange(false)
    }

    const stepIndex = WIZARD_STEPS.findIndex((item) => item.id === step)

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>生成大纲</DialogTitle>
                    <DialogDescription>
                        按结构模板展开卷纲与章纲，逐条确认后写入大纲，草案可继续编辑
                    </DialogDescription>
                </DialogHeader>

                <ol className="flex items-center gap-1" aria-label="生成步骤">
                    {WIZARD_STEPS.map((item, index) => {
                        const isActive = item.id === step
                        const isDone = index < stepIndex
                        return (
                            <li key={item.id} className="flex items-center gap-1">
                                {index > 0 ? <span className="text-xs text-muted-foreground">/</span> : null}
                                <span
                                    aria-current={isActive ? 'step' : undefined}
                                    className={cn(
                                        'rounded-full px-2 py-0.5 text-xs',
                                        isActive && 'bg-muted font-medium text-foreground',
                                        !isActive && (isDone ? 'text-foreground' : 'text-muted-foreground'),
                                    )}
                                >
                                    {index + 1}. {item.label}
                                </span>
                            </li>
                        )
                    })}
                </ol>

                <div className="@container min-h-0 flex-1 overflow-y-auto pr-0.5">
                    {step === 'input' ? (
                        <OutlineWizardInput
                            setting={setting}
                            characters={characters}
                            options={options}
                            onChangeOptions={handleOptionsChange}
                        />
                    ) : (
                        <OutlineWizardPlan
                            step={step === 'volume' ? 'volume' : 'chapter'}
                            draft={draft}
                            selectedChapterIds={selectedSet}
                            onToggleChapter={handleToggleChapter}
                            onToggleVolume={handleToggleVolume}
                        />
                    )}
                </div>

                <DialogFooter className="items-center gap-2">
                    {step !== 'input' ? (
                        <Button size="sm" variant="ghost" onClick={() => setStep(step === 'chapter' ? 'volume' : 'input')}>
                            <ArrowLeft data-icon="inline-start" />
                            上一步
                        </Button>
                    ) : null}
                    <span className="flex-1" />
                    {step === 'input' ? (
                        <Button size="sm" onClick={handleBuild}>
                            <Plus data-icon="inline-start" />
                            生成卷纲
                        </Button>
                    ) : null}
                    {step === 'volume' ? (
                        <Button size="sm" onClick={() => setStep('chapter')}>
                            下一步：勾选章纲
                            <ArrowRight data-icon="inline-end" />
                        </Button>
                    ) : null}
                    {step === 'chapter' ? (
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="tabular-nums">
                                已选 {selectedCount} 章
                            </Badge>
                            <Button size="sm" disabled={selectedCount === 0} onClick={handleApply}>
                                写入大纲
                            </Button>
                        </div>
                    ) : null}
                </DialogFooter>
                {step === 'chapter' && existingChapterCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                        当前作品已有 {existingChapterCount} 章，写入将作为新卷追加，不会覆盖既有章节。
                    </p>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
