/**
 * 按卷生成的章纲草案预览：按阶段分组展示草案，支持整组与单章勾选，并给出生成中与空状态提示。
 * 复用约定：阶段折叠取 ui/collapsible，触发器与单章条目分别收进本页 StageTriggerItem / ChapterDraftItem
 * （均取 ui/item，勾选框放 ItemActions / ItemMedia），空态与生成中提示复用 blocks/StateEmpty；
 * 分组在块内按草案阶段计算，主组件只传草案与勾选集合；
 * 关键约束：草案索引即写入顺序，展示章号由主组件按写入方式算出的起始章序累加；空阶段归入「未分组」，组序沿用草案生成顺序；
 * 内部滚动依赖父级给出确定高度（父容器 flex-1 + min-h-0），高度未约束时只能由外层容器代滚动；
 * 横向显式 hidden：Checkbox 的 -inset-x 点击区与 overflow-y-auto 都会把横向溢出算成滚动条。
 */
import { BookOpen, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { Checkbox } from '@components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import type { VolumeChapterDraft } from '@shared/types/press'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import type { ComponentProps, JSX, KeyboardEvent } from 'react'

export interface VolumeChapterDraftsProps {
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

/** 折叠标题是非原生 button 的 Item，补 Enter / Space 激活；只处理源自标题本身的按键，避免内部勾选框连带折叠 */
function activateOnEnterOrSpace(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
        return
    }
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.currentTarget.click()
    }
}

interface StageTriggerItemProps extends ComponentProps<'div'> {
    stageLabel: string
    count: number
    checked: boolean | 'indeterminate'
    onToggleStage: () => void
}

/** 阶段折叠触发器：透传 Radix 注入的属性，整组勾选框放在 ItemActions 内且不触发折叠 */
function StageTriggerItem({
    stageLabel,
    count,
    checked,
    onToggleStage,
    ...props
}: StageTriggerItemProps): JSX.Element {
    return (
        <Item
            {...props}
            variant="muted"
            size="xs"
            role="button"
            tabIndex={0}
            className="min-w-0 flex-1 cursor-pointer"
            onKeyDown={activateOnEnterOrSpace}
        >
            <ItemContent>
                <ItemTitle className="min-w-0">{stageLabel}</ItemTitle>
            </ItemContent>
            <ItemActions className="shrink-0 text-muted-foreground tabular-nums">
                {count} 章
                <Checkbox
                    checked={checked}
                    onCheckedChange={onToggleStage}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`勾选或取消「${stageLabel}」整组`}
                />
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/stage:rotate-90" />
            </ItemActions>
        </Item>
    )
}

interface ChapterDraftItemProps {
    draft: VolumeChapterDraft
    index: number
    startOrder: number
    isSelected: boolean
    onToggle: (index: number) => void
}

/** 单章条目：label 承载点击区，勾选框放 ItemMedia，index 即写入顺序 */
function ChapterDraftItem({
    draft,
    index,
    startOrder,
    isSelected,
    onToggle,
}: ChapterDraftItemProps): JSX.Element {
    const checkboxId = `chapter-draft-${String(index)}`
    return (
        <Item asChild variant={isSelected ? 'muted' : 'default'}>
            <label htmlFor={checkboxId} className="cursor-pointer">
                <ItemMedia>
                    <Checkbox id={checkboxId} checked={isSelected} onCheckedChange={() => onToggle(index)} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                    <ItemTitle className="w-full min-w-0">
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                            第 {startOrder + index} 章
                        </span>
                        <span className="min-w-0 flex-1 truncate">{draft.title}</span>
                    </ItemTitle>
                    <ItemDescription>{draft.summary}</ItemDescription>
                </ItemContent>
            </label>
        </Item>
    )
}

export function VolumeChapterDrafts({
    drafts,
    selectedSet,
    startOrder,
    isGenerating,
    onToggle,
    onToggleStage,
}: VolumeChapterDraftsProps): JSX.Element {
    const groups = useMemo(() => groupDraftsByStage(drafts), [drafts])

    return (
        <div className="min-h-0 flex-1 h-full overflow-x-hidden overflow-y-auto">
            {drafts.length === 0 ? (
                <StateEmpty
                    isLoading={isGenerating}
                    icon={BookOpen}
                    title={isGenerating ? '正在按卷纲拆章…' : '还没有草案'}
                    className="h-full"
                />
            ) : (
                <ItemGroup className="gap-3 p-2">
                    {groups.map((group) => {
                        const groupKey = group.stage.length > 0 ? group.stage : '__ungrouped'
                        const stageLabel = group.stage.length > 0 ? group.stage : '未分组'
                        const selectedCount = group.indexes.filter((index) => selectedSet.has(index)).length
                        const checked: boolean | 'indeterminate' =
                            selectedCount === 0
                                ? false
                                : selectedCount === group.indexes.length
                                  ? true
                                  : 'indeterminate'
                        return (
                            <Collapsible key={groupKey} defaultOpen className="group/stage">
                                <CollapsibleTrigger asChild>
                                    <StageTriggerItem
                                        stageLabel={stageLabel}
                                        count={group.indexes.length}
                                        checked={checked}
                                        onToggleStage={() => onToggleStage(group.indexes)}
                                    />
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <ItemGroup className="gap-1.5 pt-1.5">
                                        {group.indexes.map((index) => {
                                            const draft = drafts[index]
                                            if (draft === undefined) {
                                                return null
                                            }
                                            return (
                                                <ChapterDraftItem
                                                    key={index}
                                                    draft={draft}
                                                    index={index}
                                                    startOrder={startOrder}
                                                    isSelected={selectedSet.has(index)}
                                                    onToggle={onToggle}
                                                />
                                            )
                                        })}
                                    </ItemGroup>
                                </CollapsibleContent>
                            </Collapsible>
                        )
                    })}
                </ItemGroup>
            )}
        </div>
    )
}
