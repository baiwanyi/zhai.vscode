/**
 * 按作品设定生成的卷纲草案列表：展示卷名、预计章数与卷纲摘要，支持单卷勾选，并给出生成中与空状态提示。
 * 复用约定：条目取 ui/item（勾选框放 ItemMedia），空态与生成中提示复用 blocks/Empty；
 * 主组件只传草案、勾选集合与切换回调，草案索引即写入顺序；
 * 关键约束：内部滚动依赖父级给出确定高度（父容器 flex-1 + min-h-0），高度未约束时只能由外层容器代滚动；
 * 横向显式 hidden：Checkbox 的点击区与 overflow-y-auto 都会把横向溢出算成滚动条。
 */
import { BookOpen } from 'lucide-react'
import { Checkbox } from '@components/ui/checkbox'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import type { VolumeOutlineDraft } from '@shared/types/press'
import { Empty } from '@webview/blocks/Empty'
import type { JSX } from 'react'

export interface VolumeOutlineDraftsProps {
    drafts: readonly VolumeOutlineDraft[]
    selectedSet: ReadonlySet<number>
    isGenerating: boolean
    onToggle: (index: number) => void
}

export function VolumeOutlineDrafts({
    drafts,
    selectedSet,
    isGenerating,
    onToggle,
}: VolumeOutlineDraftsProps): JSX.Element {
    return (
        <div className="min-h-0 flex-1 h-full overflow-x-hidden overflow-y-auto">
            {drafts.length === 0 ? (
                <Empty
                    isLoading={isGenerating}
                    icon={BookOpen}
                    title={isGenerating ? '正在按作品设定分卷…' : '还没有草案'}
                    className="h-full"
                />
            ) : (
                <ItemGroup className="gap-1.5 p-2">
                    {drafts.map((draft, index) => {
                        const checkboxId = `volume-outline-draft-${String(index)}`
                        const isSelected = selectedSet.has(index)
                        return (
                            <Item key={checkboxId} asChild variant={isSelected ? 'muted' : 'default'}>
                                <label htmlFor={checkboxId} className="cursor-pointer">
                                    <ItemMedia>
                                        <Checkbox
                                            id={checkboxId}
                                            checked={isSelected}
                                            onCheckedChange={() => onToggle(index)}
                                        />
                                    </ItemMedia>
                                    <ItemContent className="min-w-0">
                                        <ItemTitle className="w-full min-w-0">
                                            <span className="min-w-0 flex-1 truncate">{draft.name}</span>
                                            <span className="shrink-0 text-muted-foreground tabular-nums">
                                                {draft.expectedChapters > 0
                                                    ? `约 ${String(draft.expectedChapters)} 章`
                                                    : '章数未定'}
                                            </span>
                                        </ItemTitle>
                                        <ItemDescription>{draft.coreEvent}</ItemDescription>
                                        {draft.mainPlot.length > 0 ? (
                                            <ItemDescription className="line-clamp-1 text-muted-foreground/80">
                                                主要情节：{draft.mainPlot.join('；')}
                                            </ItemDescription>
                                        ) : null}
                                    </ItemContent>
                                </label>
                            </Item>
                        )
                    })}
                </ItemGroup>
            )}
        </div>
    )
}
