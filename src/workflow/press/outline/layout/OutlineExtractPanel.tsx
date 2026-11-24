/**
 * 提取范围对话框内容：选择全篇 / 章节范围 / 指定章节，再按所选范围刷新章纲。
 * 复用约定：章节候选读仪表盘的作品列表（useProjectChapterOptions），选择状态与提交口径由
 * useExtractSelection 承担，三块内容分别交给 ExtractScopeOptions、ExtractRangeFields、ExtractChapterList；
 * 对话框外壳与开合由调用方提供。
 * 关键约束：候选只取作品章节而非大纲草稿——素材草案由章节清单产出，选大纲章会错位；
 * 提交后经 onClose 请外层关闭；全篇会整树覆盖，选项文案必须写明；章序只用于列表与区间，
 * 提交时换成「卷序 + 卷内位置」，大纲比作品多出的章保持原样。
 */
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@webview/components/Button'
import type { OutlineExtractTarget } from '../../types'
import type { JSX } from 'react'
import { ExtractChapterList } from '../block/ExtractChapterList'
import { ExtractRangeFields } from '../block/ExtractRangeFields'
import { ExtractScopeOptions } from '../block/ExtractScopeOptions'
import { useExtractSelection } from '../hooks/useExtractSelection'
import { useProjectChapterOptions } from '../hooks/useProjectChapterOptions'

interface OutlineExtractPanelProps {
    /** 当前作品目录：提取范围读取该作品在仪表盘里的卷章列表 */
    dirPath: string
    isExtracting: boolean
    /** 提交提取：mode 为 all 时整树覆盖，chapters 时只刷新这些卷章位置的章纲 */
    onExtract: (target: OutlineExtractTarget) => void
    /** 提交或取消后关闭对话框：开合状态在调用方，面板不自行关闭 */
    onClose: () => void
}

export function OutlineExtractPanel({
    dirPath,
    isExtracting,
    onExtract,
    onClose,
}: OutlineExtractPanelProps): JSX.Element {
    const { status, options } = useProjectChapterOptions(dirPath)
    const selection = useExtractSelection(options, isExtracting)

    const handleSubmit = (): void => {
        const target = selection.resolveTarget()
        // 指定章节一个都没选时不提交；全篇不带定位键，范围分支恒有至少一章
        if (target.mode === 'chapters' && target.keys.length === 0) {
            return
        }
        onClose()
        onExtract(target)
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="text-lg">提取范围</DialogTitle>
                <DialogDescription className="tabular-nums">{selection.summaryText}</DialogDescription>
            </DialogHeader>

            {status === 'loading' ? <p className="text-muted-foreground text-xs leading-4">正在读取作品章节…</p> : null}
            {status === 'failed' ? (
                <p className="text-muted-foreground text-xs leading-4">
                    作品章节读取失败：关闭后重试，或先在仪表盘确认该作品已建立索引。
                </p>
            ) : null}
            {status === 'ready' && options.length === 0 ? (
                <p className="text-muted-foreground text-xs leading-4">
                    作品列表还没有章节：先在仪表盘新增卷与章节，再回来按素材提取。
                </p>
            ) : null}

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
                    按作品章节定位：只刷新大纲里同卷同位置的章纲，大纲比作品多出的章保持原样。
                </p>
            )}

            <DialogFooter>
                <Button variant="outline" onClick={onClose}>
                    取消
                </Button>
                <Button variant="primary" disabled={selection.isSubmitDisabled} onClick={handleSubmit}>
                    {isExtracting ? '提取中' : '开始提取'}
                </Button>
            </DialogFooter>
        </>
    )
}
