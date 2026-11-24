/**
 * 按卷生成的章纲草案预览：按阶段分组展示草案，支持整组与单章勾选，并给出生成中与空状态提示。
 * 复用约定：条目取 ui/field 的 Choice Card（FieldLabel + 横排 Field + Checkbox），阶段取 FieldSet / FieldLegend；
 * 生成态光晕取 components/AppComposer 的 ComposerGlow，与输入卡片共用同一套描边与背光；
 * 分组在块内按草案阶段计算，主组件只传草案与勾选集合；
 * 关键约束：草案索引即写入顺序，展示章号由主组件按写入方式算出的起始章序累加；空阶段归入「未分组」，组序沿用草案生成顺序；
 * 光晕挂在不滚动的 isolate 外层，外扩背光才不会被滚动容器裁掉；同色底衬压住卡内背光，只留边缘溢出可见。
 */
import { useMemo } from 'react'
import { Checkbox } from '@components/ui/checkbox'
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
    FieldTitle,
} from '@components/ui/field'
import type { VolumeChapterDraft } from '@shared/types/press'
import { AI_FIELD_GLOW_CLASS, ComposerGlow } from '@webview/components/AppComposer'
import type { JSX } from 'react'

export interface ChapterDraftPreviewProps {
    drafts: readonly VolumeChapterDraft[]
    selectedSet: ReadonlySet<number>
    /** 起始章序：展示章号由它按草案索引累加，与主组件写入口径一致 */
    startOrder: number
    isGenerating: boolean
    onToggle: (index: number) => void
    onToggleStage: (indexes: readonly number[]) => void
}

interface StageGroup {
    stage: string
    indexes: number[]
}

/** 预览分组：按草案的阶段名切片，保留首次出现的组序与组内顺序 */
function groupDraftsByStage(drafts: readonly VolumeChapterDraft[]): StageGroup[] {
    const groups = new Map<string, number[]>()
    drafts.forEach((draft, index) => {
        const stage = typeof draft.stage === 'string' ? draft.stage.trim() : ''
        const bucket = groups.get(stage)
        if (bucket === undefined) {
            groups.set(stage, [index])
        } else {
            bucket.push(index)
        }
    })
    return [...groups].map(([stage, indexes]) => ({ stage, indexes }))
}

export function ChapterDraftPreview({
    drafts,
    selectedSet,
    startOrder,
    isGenerating,
    onToggle,
    onToggleStage,
}: ChapterDraftPreviewProps): JSX.Element {
    const groups = useMemo(() => groupDraftsByStage(drafts), [drafts])

    return (
        <div className="relative isolate min-h-0 flex-1">
            <ComposerGlow isGenerating={isGenerating} className={AI_FIELD_GLOW_CLASS} />
            {/* 同色底衬压在光晕之上：负 z 子层会画在父背景之上，少了它卡内会透出彩色背光 */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-lg bg-popover" />
            <div className="h-full overflow-y-auto rounded-lg border border-border">
                {drafts.length === 0 ? (
                    <p className="p-3 text-muted-foreground">
                        {isGenerating
                            ? '正在按卷纲拆章，整卷生成需要一点时间…'
                            : '还没有草案。先补全卷纲的「主要情节」，再点「开始生成」。'}
                    </p>
                ) : (
                    <FieldGroup className="gap-4 p-2">
                        {groups.map((group) => (
                            <FieldSet key={group.stage.length > 0 ? group.stage : '__ungrouped'}>
                                <FieldLegend variant="label">
                                    <span className="flex w-full items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            className="min-w-0 cursor-pointer truncate text-left hover:underline"
                                            title="点击勾选或取消整组"
                                            onClick={() => onToggleStage(group.indexes)}
                                        >
                                            {group.stage.length > 0 ? group.stage : '未分组'}
                                        </button>
                                        <span className="shrink-0 text-muted-foreground tabular-nums">
                                            {group.indexes.length} 章
                                        </span>
                                    </span>
                                </FieldLegend>
                                <FieldGroup className="gap-1.5">
                                    {group.indexes.map((index) => {
                                        const draft = drafts[index]
                                        if (draft === undefined) {
                                            return null
                                        }
                                        const checkboxId = `chapter-draft-${String(index)}`
                                        return (
                                            <FieldLabel key={checkboxId} htmlFor={checkboxId}>
                                                <Field orientation="horizontal">
                                                    <FieldContent>
                                                        <FieldTitle className="w-full min-w-0">
                                                            <span className="shrink-0 text-muted-foreground tabular-nums">
                                                                第 {startOrder + index} 章
                                                            </span>
                                                            <span className="min-w-0 flex-1 truncate">{draft.title}</span>
                                                        </FieldTitle>
                                                        <FieldDescription className="line-clamp-2">
                                                            {draft.summary}
                                                        </FieldDescription>
                                                    </FieldContent>
                                                    <Checkbox
                                                        id={checkboxId}
                                                        checked={selectedSet.has(index)}
                                                        onCheckedChange={() => onToggle(index)}
                                                    />
                                                </Field>
                                            </FieldLabel>
                                        )
                                    })}
                                </FieldGroup>
                            </FieldSet>
                        ))}
                    </FieldGroup>
                )}
            </div>
        </div>
    )
}
