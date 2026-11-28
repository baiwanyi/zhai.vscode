/**
 * 留言筛选栏：全部 / 精选 / 待回复三段切换，右侧给出已加载口径。
 * 复用约定：分段控件取 components/SegmentedRail（outline 形态与统计页一致），条数取 utils/commentFilter；
 * 右侧口径文案由 utils/commentText 的 readFilterCaption 生成，不在这里拼数字。
 * 关键约束：标签上的数字只覆盖已加载条目——平台列表接口没有筛选参数，界面必须让这个边界可读；
 * 组件自身不持有筛选状态，切换批次或文章时由父层重置，避免筛选值跨文章残留。
 */
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { CommentFilter, WechatCommentActions } from '../types'
import type { CommentFilterCounts } from '../utils/commentFilter'
import type { JSX } from 'react'
import { readFilterCaption } from '../utils/commentText'

/** 收窄分段回传值：SegmentedRail 回传的是普通字符串 */
function readFilter(value: string): CommentFilter {
    return value === 'elected' || value === 'unreplied' ? value : 'all'
}

interface WechatCommentFiltersProps {
    filter: CommentFilter
    counts: CommentFilterCounts
    loaded: number
    total: number
    actions: WechatCommentActions
}

export function WechatCommentFilters({
    filter,
    counts,
    loaded,
    total,
    actions,
}: WechatCommentFiltersProps): JSX.Element {
    const items: readonly { value: CommentFilter; label: string }[] = [
        { value: 'all', label: `全部 ${String(counts.all)}` },
        { value: 'elected', label: `精选 ${String(counts.elected)}` },
        { value: 'unreplied', label: `待回复 ${String(counts.unreplied)}` },
    ]

    return (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SegmentedRail
                items={items}
                value={filter}
                onChange={(value) => actions.onChangeFilter(readFilter(value))}
                label="筛选"
                variant="outline"
                size="sm"
                isStretched={false}
            />
            <span className="shrink-0 text-xs text-muted-foreground">{readFilterCaption(loaded, total)}</span>
        </div>
    )
}
