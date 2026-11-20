/**
 * 表情选择器：发表框工具栏上的 Popover，按分类分组展示并插入表情。
 * 复用约定：Popover 取 @components/ui/popover，按钮取 @webview/components/Button，
 * 表情图统一走 useWeiboImage 换本地地址（图床按 Referer 放行，Webview 直连会被拒）。
 * 关键约束：hooks 只能在组件内调用，故每个表情抽成 EmoticonCell，不能在 map 里直接调；
 * 分类由宿主回填到 category，本组件只按首次出现顺序聚合，不自行排序；
 * 单个分类可能上百个表情，首屏只渲染一页并在底部按页追加，避免一次打满图片通道；
 * 切换分类要重置分页计数，否则新分类会沿用上一个分类的展开量；选中后立即收起面板。
 */
import { cn } from 'cn'
import { Smile } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Spinner } from '@components/ui/spinner'
import type { WeiboEmoticonItem } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { useWeiboEmoticons } from '../hooks/useWeiboEmoticons'
import { useWeiboImage } from '../hooks/useWeiboImage'

/** 首屏渲染条数：8 列 5 行，够看清常用表情又不至于一次发起上百个下载 */
const INITIAL_VISIBLE = 40

/** 每次追加条数：与首屏同量级，滚动到底再取一页 */
const PAGE_STEP = 40

/** 未分类表情归入的名称：上游理论上不会缺分类，这里只作兜底 */
const DEFAULT_CATEGORY = '默认'

interface EmoticonGroup {
    category: string
    items: WeiboEmoticonItem[]
}

/** 按分类聚合：保持上游顺序，未分类归入「默认」 */
function groupEmoticons(items: WeiboEmoticonItem[]): EmoticonGroup[] {
    const groups = new Map<string, WeiboEmoticonItem[]>()
    for (const item of items) {
        const category = item.category.length > 0 ? item.category : DEFAULT_CATEGORY
        const bucket = groups.get(category)
        if (bucket === undefined) {
            groups.set(category, [item])
            continue
        }
        bucket.push(item)
    }
    return [...groups.entries()].map(([category, groupItems]) => ({ category, items: groupItems }))
}

interface EmoticonCellProps {
    item: WeiboEmoticonItem
    onSelect: (phrase: string) => void
}

/** 单个表情：取图完成前显示脉冲方块，失败保留灰块并由 title 兜出名称 */
function EmoticonCell({ item, onSelect }: EmoticonCellProps): JSX.Element {
    const { localUrl, isFailed } = useWeiboImage(item.url)
    return (
        <button
            type="button"
            title={item.phrase}
            aria-label={item.phrase}
            className="flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
                onSelect(item.phrase)
            }}
        >
            {localUrl === null ? (
                <span aria-hidden="true" className={cn('size-6 rounded bg-muted', !isFailed && 'animate-pulse')} />
            ) : (
                <img src={localUrl} alt={item.phrase} className="size-6" loading="lazy" />
            )}
        </button>
    )
}

interface WeiboEmoticonPickerProps {
    /** 是否具备取数条件：未配置 Cookie 时只给引导，不发请求 */
    isEnabled: boolean
    onSelect: (phrase: string) => void
}

export function WeiboEmoticonPicker({ isEnabled, onSelect }: WeiboEmoticonPickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
    const [selectedCategory, setSelectedCategory] = useState('')
    const { state, load } = useWeiboEmoticons(isEnabled)

    const groups = useMemo(() => groupEmoticons(state.emoticons), [state.emoticons])
    // 上一次选中的分类可能已不在结果里（刷新后分组变化），此时回落到第一个分类
    const activeCategory = groups.some((group) => group.category === selectedCategory)
        ? selectedCategory
        : (groups[0]?.category ?? '')
    const activeItems = groups.find((group) => group.category === activeCategory)?.items ?? []
    const visible = activeItems.slice(0, visibleCount)
    const hasMore = activeItems.length > visible.length

    const handleOpenChange = useCallback(
        (open: boolean): void => {
            setIsOpen(open)
            setVisibleCount(INITIAL_VISIBLE)
            if (open) {
                void load()
            }
        },
        [load],
    )

    const handleSelect = useCallback(
        (phrase: string): void => {
            onSelect(phrase)
            setIsOpen(false)
        },
        [onSelect],
    )

    const handleSelectCategory = useCallback((category: string): void => {
        setSelectedCategory(category)
        setVisibleCount(INITIAL_VISIBLE)
    }, [])

    const handleLoadMore = useCallback((): void => {
        setVisibleCount((previous) => previous + PAGE_STEP)
    }, [])

    const handleRetry = useCallback((): void => {
        void load()
    }, [load])

    /** 面板主体：未配置 / 首次加载 / 失败 / 分类切换 + 表情网格 */
    function renderBody(): JSX.Element {
        if (!isEnabled) {
            return <PopoverDescription>先在「设置」里保存登录 Cookie，才能读取表情配置。</PopoverDescription>
        }
        if (state.isLoading && state.emoticons.length === 0) {
            return (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Spinner className="size-3.5" aria-hidden="true" />
                    正在读取表情...
                </div>
            )
        }
        if (state.errorMessage !== null && state.emoticons.length === 0) {
            return (
                <div className="flex flex-col gap-2">
                    <PopoverDescription>{state.errorMessage}</PopoverDescription>
                    <Button size="sm" variant="outline" onClick={handleRetry}>
                        重试
                    </Button>
                </div>
            )
        }
        return (
            <>
                <div className="flex gap-1 overflow-x-auto pb-0.5">
                    {groups.map((group) => (
                        <Button
                            key={group.category}
                            size="xs"
                            variant={group.category === activeCategory ? 'secondary' : 'ghost'}
                            className="shrink-0"
                            title={`${group.category}（${String(group.items.length)} 个）`}
                            onClick={() => {
                                handleSelectCategory(group.category)
                            }}
                        >
                            {group.category}
                        </Button>
                    ))}
                </div>
                <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
                    {visible.map((item) => (
                        <EmoticonCell key={item.phrase} item={item} onSelect={handleSelect} />
                    ))}
                </div>
                {hasMore ? (
                    <Button size="sm" variant="outline" onClick={handleLoadMore}>
                        加载更多表情
                    </Button>
                ) : (
                    <p className="text-center text-muted-foreground text-xs">
                        {activeCategory} 共 {activeItems.length} 个表情，点击插入到光标处
                    </p>
                )}
            </>
        )
    }

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" title="插入表情">
                    <Smile className="size-3.5" aria-hidden="true" />
                    表情
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-96"
                onCloseAutoFocus={(event) => {
                    // 选择表情后焦点要交回输入框：阻止 Radix 把它还给触发按钮
                    event.preventDefault()
                }}
            >
                <PopoverHeader>
                    <PopoverTitle>插入表情</PopoverTitle>
                    <PopoverDescription>点击插入到正文光标处，正文按 [名称] 文本形态保留。</PopoverDescription>
                </PopoverHeader>
                {renderBody()}
            </PopoverContent>
        </Popover>
    )
}
