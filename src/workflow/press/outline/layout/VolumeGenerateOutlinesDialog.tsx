/**
 * 按作品设定生成卷纲的预览对话框：先生成卷名、预计章节数与卷纲五项，勾选后再覆盖写入。
 * 复用约定：骨架取业务公共层的 Dialog（取消 / 写入按钮、高度与滚动由它统一提供）；
 * 期望卷数与生成按钮收进 ui/input-group，已选数量与覆盖范围收进 ui/card；
 * 草案列表、加载与空态收进 block/VolumeOutlineDrafts，生成状态由 hooks/useVolumeOutlinesGenerate 持有。
 * 关键约束：草案不落库，关掉即丢弃；写入只覆盖卷纲字段，章节内容一律不动；
 * 按卷序对齐现有卷，多出的草案追加为新卷，现有卷多于草案的保持原样；
 * 期望卷数改动即清空草案待重生成，异步结果经卸载与代次守卫作废；调用方须把 key 绑定到打开状态以重建组件。
 */
import { Hash, Loader2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import type { VolumeOutlineDraft } from '@shared/types/press'
import { Dialog } from '@webview/components/Dialog'
import type { CharacterCard, ProjectSetting } from '../../types'
import type { JSX } from 'react'
import { VolumeOutlineDrafts } from '../block/VolumeOutlineDrafts'
import { useVolumeOutlinesGenerate } from '../hooks/useVolumeOutlinesGenerate'

/** 期望卷数上限：与宿主侧收窄口径一致 */
const MAX_VOLUME_COUNT = 20

interface VolumeGenerateOutlinesDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    setting: ProjectSetting
    characters: CharacterCard[]
    /** 现有卷名：交给模型避免重名，同时在标题里说明覆盖语义 */
    existingNames: readonly string[]
    /** 覆盖写入：按卷序覆盖现有卷纲，多出的追加为新卷（章节保留），返回写入卷数 */
    onApply: (drafts: readonly VolumeOutlineDraft[]) => number
}

export function VolumeGenerateOutlinesDialog({
    isOpen,
    onOpenChange,
    setting,
    characters,
    existingNames,
    onApply,
}: VolumeGenerateOutlinesDialogProps): JSX.Element {
    const { isGenerating, generate } = useVolumeOutlinesGenerate()
    /** 卸载守卫：异步生成返回后据此跳过已关闭对话框的 setState，effect 内重置兼容 StrictMode 双调用 */
    const isMountedRef = useRef(true)
    /** 生成代次：修改期望卷数时自增，避免旧请求回来覆盖已清空的新状态 */
    const generationIdRef = useRef(0)
    useEffect(() => {
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])
    const [drafts, setDrafts] = useState<VolumeOutlineDraft[]>([])
    const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
    const [volumeCount, setVolumeCount] = useState('')

    const selectedSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes])

    const handleCountChange = (value: string): void => {
        const parsed = Number(value)
        const next = Number.isFinite(parsed) && parsed > 0 ? String(Math.min(Math.round(parsed), MAX_VOLUME_COUNT)) : ''
        if (next === volumeCount) {
            return
        }
        generationIdRef.current += 1
        setVolumeCount(next)
        setDrafts([])
        setSelectedIndexes([])
        if (drafts.length > 0 || isGenerating) {
            toast.info('期望卷数已变更，请重新生成卷纲')
        }
    }

    const handleGenerate = useCallback((): void => {
        if (isGenerating) {
            return
        }
        const parsed = Number(volumeCount)
        const generationId = ++generationIdRef.current
        const run = async (): Promise<void> => {
            const result = await generate({
                volumeCount: Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), MAX_VOLUME_COUNT) : 0,
                setting,
                characters,
                existingNames,
            })
            if (!isMountedRef.current || result === null || generationId !== generationIdRef.current) {
                return
            }
            setDrafts(result)
            setSelectedIndexes(result.map((_, index) => index))
        }
        void run()
    }, [characters, existingNames, generate, isGenerating, setting, volumeCount])

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
        <Dialog
            open={isOpen}
            title="生成卷纲"
            description={
                existingNames.length > 0
                    ? `生成卷纲草案，勾选后覆盖现有 ${String(existingNames.length)} 卷`
                    : '生成卷纲草案，勾选后新建卷'
            }
            confirmLabel="写入卷纲"
            isDisabled={selectedSet.size === 0 || isGenerating}
            className="sm:max-w-3xl"
            onOpenChange={onOpenChange}
            onConfirm={handleApply}
        >
            <Card className="min-h-0 flex-1 p-0 ring-0">
                <CardHeader className="items-center px-3">
                    <CardTitle>
                        <InputGroup className="w-fit has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:ring-0">
                            <InputGroupAddon align="inline-start">
                                <Hash className="size-4" aria-hidden="true" />
                            </InputGroupAddon>
                            <InputGroupInput
                                type="number"
                                min={1}
                                max={MAX_VOLUME_COUNT}
                                value={volumeCount}
                                className="w-20 py-0 leading-8 tabular-nums"
                                placeholder="期望卷数"
                                aria-label="期望卷数"
                                onChange={(event) => handleCountChange(event.target.value)}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    variant="default"
                                    tooltip={drafts.length > 0 ? '重新生成' : '开始生成'}
                                    disabled={isGenerating}
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
                                已选 {selectedSet.size} / {drafts.length} 卷
                            </Badge>
                        ) : null}
                    </CardAction>
                    <CardDescription className="col-span-2">只覆盖卷纲字段，已写章节、节拍与场景保留。</CardDescription>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col px-0">
                    <VolumeOutlineDrafts
                        drafts={drafts}
                        selectedSet={selectedSet}
                        isGenerating={isGenerating}
                        onToggle={handleToggle}
                    />
                </CardContent>
            </Card>
        </Dialog>
    )
}
