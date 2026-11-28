/**
 * 留言筛选栏：全部 / 精选 / 待回复三段切换，右侧给出已加载口径与当前文章的评论开关。
 * 复用约定：分段控件取 components/SegmentedRail，开关取 components/Switch，条数取 utils/commentFilter；
 * 右侧口径文案由 utils/commentText 的 readFilterCaption 生成，不在这里拼数字。
 * 关键约束：标签数字只覆盖已加载条目，界面必须让这个边界可读；开关只在选中文章时显示，
 * 状态来自本地文章元信息（平台无查询接口），切换中由父层禁用，避免重复提交。
 */
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { Switch } from '@webview/components/Switch'
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
    /** 当前文章的评论开关状态：null 表示没有选中文章，不显示开关 */
    isCommentEnabled: boolean | null
    isMutating: boolean
    actions: WechatCommentActions
}

export function WechatCommentFilters({
    filter,
    counts,
    loaded,
    total,
    isCommentEnabled,
    isMutating,
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
            <div className="flex shrink-0 items-center gap-3">
                {isCommentEnabled === null ? null : (
                    <Switch
                        size="sm"
                        checked={isCommentEnabled}
                        disabled={isMutating}
                        label="开放评论"
                        onCheckedChange={(checked) => actions.onToggleComment(checked === true)}
                    />
                )}
                <span className="text-xs text-muted-foreground">{readFilterCaption(loaded, total)}</span>
            </div>
        </div>
    )
}
