/**
 * 提取范围菜单：点「提取」先选全篇 / 章节范围 / 指定章节，再按所选范围刷新章纲。
 * 复用约定：选择状态与提交口径由 useExtractSelection 承担，三块内容分别交给
 * ExtractScopeOptions、ExtractRangeFields、ExtractChapterList；弹层取 @components/ui/popover，
 * 触发与提交按钮复用 components/Button，头部摘要由 Hook 给出。
 * 关键约束：弹层开合是视图状态，留在本文件；章序统一为 1 基全局序号，组件与子组件都不得重排；
 * 全篇会整树覆盖，选项文案必须写明；提交前只需拦「指定章节一个都没选」，范围与全篇恒可提交。
 */
import { BookUp2 } from 'lucide-react'
import { useState } from 'react'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Button } from '@webview/components/Button'
import { ExtractChapterList } from './ExtractChapterList'
import { ExtractRangeFields } from './ExtractRangeFields'
import { ExtractScopeOptions } from './ExtractScopeOptions'
import type { OutlineExtractTarget, OutlineTreeEntry } from '../../types'
import type { JSX } from 'react'
import { useExtractSelection } from '../hooks/useExtractSelection'

interface OutlineExtractMenuProps {
    /** 当前大纲的卷章，顺序即全局章序（组件内不重排） */
    entries: readonly OutlineTreeEntry[]
    isExtracting: boolean
    /** 提交提取：mode 为 all 时整树覆盖，orders 时只刷新这些 1 基全局章序 */
    onExtract: (target: OutlineExtractTarget) => void
}

export function OutlineExtractMenu({ entries, isExtracting, onExtract }: OutlineExtractMenuProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const selection = useExtractSelection(entries, isExtracting)

    const handleSubmit = (): void => {
        const target = selection.resolveTarget()
        // 指定章节一个都没选时不提交；全篇不带章序，范围分支恒有至少一章
        if (target.mode === 'orders' && target.orders.length === 0) {
            return
        }
        setIsOpen(false)
        onExtract(target)
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" disabled={isExtracting} tooltip="按已抽取的素材重建章纲">
                    <BookUp2 />
                    {isExtracting ? '提取中' : '提取'}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
                <PopoverHeader>
                    <PopoverTitle>提取范围</PopoverTitle>
                    <PopoverDescription className="tabular-nums">{selection.summaryText}</PopoverDescription>
                </PopoverHeader>

                <ExtractScopeOptions value={selection.scope} onChange={selection.changeScope} />

                {selection.scope === 'range' ? (
                    <ExtractRangeFields
                        start={selection.rangeStart}
                        end={selection.rangeEnd}
                        max={Math.max(selection.totalCount, 1)}
                        endPlaceholder={String(Math.max(selection.totalCount, 1))}
                        onChangeStart={selection.changeRangeStart}
                        onChangeEnd={selection.changeRangeEnd}
                    />
                ) : null}

                {selection.scope === 'chapters' ? (
                    <ExtractChapterList
                        volumeOptions={selection.volumeOptions}
                        visibleOptions={selection.visibleOptions}
                        volumeFilter={selection.volumeFilter}
                        selectedOrders={selection.validSelectedOrders}
                        onVolumeFilterChange={selection.changeVolumeFilter}
                        onToggleChapter={selection.toggleChapter}
                        onSelectAll={selection.selectAllVisible}
                        onClear={selection.clearSelection}
                    />
                ) : null}

                {selection.scope === 'all' ? null : (
                    <p className="text-muted-foreground text-xs leading-4">
                        范围按当前章序对应素材章节，手动增删过章节时可能错位；拿不准时先用全篇重建。
                    </p>
                )}

                <Button variant="primary" disabled={selection.isSubmitDisabled} onClick={handleSubmit}>
                    {isExtracting ? '提取中' : '开始提取'}
                </Button>
            </PopoverContent>
        </Popover>
    )
}
