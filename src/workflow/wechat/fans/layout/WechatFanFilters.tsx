/**
 * 用户筛选栏：关键词搜索、标签下拉与用户状态下拉。
 * 复用约定：搜索用 ui/input-group，两个下拉用 OptionSelect，选项列表用 useMemo 保持引用稳定；
 * 输入值由父层持有，防抖也在父层完成，本组件只负责呈现与转发变更。
 * 关键约束：关键词长度上限复用 WECHAT_FAN_KEYWORD_MAX，与宿主守卫同口径；
 * 状态下拉四态互斥，blocked 由数据层映射到 isBlocked，其余映射到 subscribeStatus；
 * 标签 id 用字符串哨兵 all 表示不限，回调再还原为 number | null，避免下拉组件依赖数字类型。
 */
import { Search } from 'lucide-react'
import { useMemo } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import type { WechatFanStatusFilter, WechatFanTag } from '@shared/types/wechat'
import { WECHAT_FAN_KEYWORD_MAX } from '@shared/types/wechat'
import { OptionSelect, type OptionSelectOption } from '@webview/components/OptionSelect'
import type { JSX } from 'react'

/** 标签下拉的哨兵值：'all' 表示不限标签 */
const ALL_TAGS = 'all'

const STATUS_OPTIONS: readonly OptionSelectOption<WechatFanStatusFilter>[] = [
    { value: 'all', label: '全部状态' },
    { value: 'subscribed', label: '已关注' },
    { value: 'unsubscribed', label: '已取关' },
    { value: 'blocked', label: '已拉黑' },
]

interface WechatFanFiltersProps {
    tags: WechatFanTag[]
    tagId: number | null
    statusFilter: WechatFanStatusFilter
    keywordDraft: string
    onTagChange: (id: number | null) => void
    onStatusFilterChange: (status: WechatFanStatusFilter) => void
    onKeywordChange: (value: string) => void
}

export function WechatFanFilters({
    tags,
    tagId,
    statusFilter,
    keywordDraft,
    onTagChange,
    onStatusFilterChange,
    onKeywordChange,
}: WechatFanFiltersProps): JSX.Element {
    const tagFilterOptions = useMemo(
        () => [
            { value: ALL_TAGS, label: '全部标签' },
            ...tags.map((tag) => ({ value: String(tag.id), label: tag.name })),
        ],
        [tags],
    )

    return (
        <div className="grid grid-cols-4 items-center gap-2">
            <OptionSelect
                value={tagId === null ? ALL_TAGS : String(tagId)}
                options={tagFilterOptions}
                label="按标签筛选"
                className="min-w-0 w-full"
                onChange={(value) => onTagChange(value === ALL_TAGS ? null : Number(value))}
            />
            <OptionSelect
                value={statusFilter}
                options={STATUS_OPTIONS}
                label="用户状态"
                className="min-w-0 w-full"
                onChange={onStatusFilterChange}
            />
            <InputGroup className="has-[[data-slot=input-group-control]:focus-visible]:ring-0 col-span-2 min-w-0">
                <InputGroupAddon>
                    <Search className="size-3.5" />
                </InputGroupAddon>
                <InputGroupInput
                    value={keywordDraft}
                    maxLength={WECHAT_FAN_KEYWORD_MAX}
                    placeholder="搜索昵称、备注或 OpenID"
                    aria-label="搜索用户"
                    onChange={(event) => onKeywordChange(event.target.value)}
                />
            </InputGroup>
        </div>
    )
}
