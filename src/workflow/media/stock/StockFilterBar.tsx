/**
 * 在线图库筛选行：关键词输入 + 方向下拉 + 排序下拉，整行收进 AppMenu。
 * 复用约定：输入取 @components/ui/input-group（图标进 inline-start addon），方向与排序取 @components/ui/select；
 * 刷新不在此处——标题行「更多」菜单里已有同一能力，避免两个入口。
 * 关键约束：输入不做本地防抖——防抖在 useStockPhotos 里统一处理，组件只透传原样文本；
 * 方向用 'any' 表达「不限」、排序用 'default' 表达「默认」，回传时都折算成 null，不把空串塞进协议；
 * 话题浏览时上游端点不接受 orientation，方向下拉禁用；关键词搜索不支持 order_by，排序下拉禁用。
 */
import { Search } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { StockOrderBy, StockOrientation } from '@shared/types/stock'
import type { JSX } from 'react'

/** 方向下拉值：'any' 是「不限」的本地表达，不进入协议 */
type OrientationValue = 'any' | StockOrientation

const ORIENTATION_OPTIONS: readonly { value: OrientationValue; label: string }[] = [
    { value: 'any', label: '不限方向' },
    { value: 'landscape', label: '横图' },
    { value: 'portrait', label: '竖图' },
]

/** 排序下拉值：'default' 是「默认」的本地表达，不进入协议 */
type OrderByValue = 'default' | StockOrderBy

const ORDER_BY_OPTIONS: readonly { value: OrderByValue; label: string }[] = [
    { value: 'default', label: '默认排序' },
    { value: 'latest', label: '最新' },
    { value: 'oldest', label: '最旧' },
    { value: 'popular', label: '热门' },
]

interface StockFilterBarProps {
    query: string
    onQueryChange: (value: string) => void
    orientation: StockOrientation | null
    onOrientationChange: (value: StockOrientation | null) => void
    orderBy: StockOrderBy | null
    onOrderByChange: (value: StockOrderBy | null) => void
    isDisabled?: boolean
    /** 话题浏览中：方向筛选对上游无效，下拉禁用 */
    isOrientationDisabled?: boolean
    /** 关键词搜索中：上游搜索端点不支持 order_by，排序下拉禁用 */
    isSortDisabled?: boolean
}

export function StockFilterBar({
    query,
    onQueryChange,
    orientation,
    onOrientationChange,
    orderBy,
    onOrderByChange,
    isDisabled = false,
    isOrientationDisabled = false,
    isSortDisabled = false,
}: StockFilterBarProps): JSX.Element {
    return (
        <div className="flex w-full items-center gap-2">
            <InputGroup>
                <InputGroupAddon align="inline-start">
                    <InputGroupText>
                        <Search />
                    </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                    value={query}
                    placeholder="搜索图片，英文关键词命中率更高"
                    disabled={isDisabled}
                    onChange={(event) => onQueryChange(event.target.value)}
                />
            </InputGroup>

            <Select
                value={orientation ?? 'any'}
                onValueChange={(value) => {
                    // 回传值过一遍选项表收窄：Radix 的回调参数是宽泛的 string
                    const option = ORIENTATION_OPTIONS.find((item) => item.value === value)
                    onOrientationChange(option !== undefined && option.value !== 'any' ? option.value : null)
                }}
            >
                <SelectTrigger
                    className="h-8 flex-1"
                    aria-label="图片方向"
                    disabled={isDisabled || isOrientationDisabled}
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {ORIENTATION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select
                value={orderBy ?? 'default'}
                onValueChange={(value) => {
                    const option = ORDER_BY_OPTIONS.find((item) => item.value === value)
                    onOrderByChange(option !== undefined && option.value !== 'default' ? option.value : null)
                }}
            >
                <SelectTrigger className="h-8 flex-1" aria-label="排序方式" disabled={isDisabled || isSortDisabled}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {ORDER_BY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
