/**
 * 指定章节列表：卷筛选 + 全选 / 清空 + 可勾选的章列表。
 * 复用约定：卷筛选取 components/OptionSelect，列表滚动取 ui/scroll-area，行与操作按钮取 components/Button，
 * 勾选框取 ui/checkbox，章节选项类型来自 ../utils 的 ExtractChapterOption。
 * 关键约束：整行按钮是唯一切换入口，Checkbox 只作视觉指示（pointer-events-none + aria-hidden），
 * 否则控件自身的切换与行点击会叠加成「点了没反应」；ScrollArea 内必须把 Radix 的 display:table
 * 内容壳压回 block，否则长标题撑宽行、truncate 拿不到可用宽度。
 */
import { useMemo } from 'react'
import { Checkbox } from '@components/ui/checkbox'
import { ScrollArea } from '@components/ui/scroll-area'
import { Button } from '@webview/components/Button'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { ExtractChapterOption } from '../../utils'
import type { JSX } from 'react'

interface ExtractChapterListProps {
    /** 卷筛选选项：取值为卷 id，'all' 为全部卷 */
    volumeOptions: readonly { value: string; label: string }[]
    /** 当前筛选下可见的章节 */
    visibleOptions: readonly ExtractChapterOption[]
    volumeFilter: string
    selectedOrders: readonly number[]
    onVolumeFilterChange: (value: string) => void
    onToggleChapter: (order: number) => void
    onSelectAll: () => void
    onClear: () => void
}

export function ExtractChapterList({
    volumeOptions,
    visibleOptions,
    volumeFilter,
    selectedOrders,
    onVolumeFilterChange,
    onToggleChapter,
    onSelectAll,
    onClear,
}: ExtractChapterListProps): JSX.Element {
    const selectedSet = useMemo(() => new Set(selectedOrders), [selectedOrders])

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
                <OptionSelect
                    value={volumeFilter}
                    options={[{ value: 'all', label: '全部卷' }, ...volumeOptions]}
                    ariaLabel="按卷筛选章节"
                    className="min-w-0 flex-1"
                    onChange={onVolumeFilterChange}
                />
                <Button variant="outline" onClick={onSelectAll}>
                    全选
                </Button>
                <Button variant="outline" onClick={onClear}>
                    清空
                </Button>
            </div>
            <ScrollArea className="h-44 rounded-md border border-border [&_[data-slot=scroll-area-viewport]>div]:block!">
                <div className="flex flex-col gap-0.5 p-1">
                    {visibleOptions.length === 0 ? (
                        <p className="px-2 py-3 text-center text-muted-foreground text-xs">当前筛选下没有章节</p>
                    ) : (
                        visibleOptions.map((option) => {
                            const isSelected = selectedSet.has(option.order)
                            return (
                                <Button
                                    key={option.order}
                                    variant="ghost"
                                    role="checkbox"
                                    aria-checked={isSelected}
                                    aria-label={option.label}
                                    className="w-full min-w-0 justify-start gap-2 px-1.5 py-1 font-normal"
                                    onClick={() => onToggleChapter(option.order)}
                                >
                                    <Checkbox
                                        checked={isSelected}
                                        aria-hidden="true"
                                        tabIndex={-1}
                                        className="pointer-events-none rounded-full"
                                    />
                                    <span className="min-w-0 flex-1 text-left truncate">{option.title}</span>
                                </Button>
                            )
                        })
                    )}
                </div>
            </ScrollArea>
        </div>
    )
}
