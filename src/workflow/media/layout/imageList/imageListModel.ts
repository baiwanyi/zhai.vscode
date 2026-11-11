/**
 * 统一图片列表的类型契约：条目、分组、动作、状态位与续载策略的唯一定义处。
 * 复用约定：图标沿用 StateEmpty 的函数签名以兼容 lucide 图标，领域对象经 source 原样回传，
 * 组件层不认识 MediaItem / StockPhoto 等具体类型；比例与栅格类名在此写全，避免 Tailwind 漏扫动态拼接。
 * 关键约束：数据以 flat / grouped 二选一的联合传入，避免两种模式同时给出产生歧义；
 * 列表为受控纯展示，加载、删除确认与任何宿主请求都由调用方持有；
 * 悬停动作统一排在右下角竖列、与左下角信息角标分居两侧，避免按钮压住常驻文案。
 */
import type { ReactNode } from 'react'

/** 图标：与 StateEmpty 同款可调用签名，lucide 图标可直接传入 */
export type ImageListIcon = (props: { className?: string }) => ReactNode

export type ImageListAspect = '3/4' | '4/3' | 'square'
export type ImageListColumns = 'compact' | 'responsive'

export interface ImageListBadge {
    /** 角标文案：纯图标角标可省略 */
    text?: string
    /** 左上、右上、左下三个信息角标位置：左下用于关联角标与上传尺寸文案 */
    position: 'top-left' | 'top-right' | 'bottom-left'
    variant?: 'secondary' | 'outline' | 'destructive'
    /** 图标：给出时渲染在文案之前，关联角标靠它表达语义 */
    icon?: ImageListIcon
    /** 悬停展开的标题：只在首次悬停时按需请求，列表阶段不为每张图各发一次 */
    hoverTitles?: () => Promise<readonly string[]>
}

/** 单张卡片的展示数据：适配器由领域条目映射而来 */
export interface ImageListItem<T = unknown> {
    id: string
    /** null 表示非图片文件或缩略图缺失，走图标占位 */
    src: string | null
    alt: string
    /** 底部说明：出处、署名或文件名 */
    title?: string
    /** 图片下方的副文案：体积等 */
    meta?: string
    /** 卡片主动作的可访问名 */
    activateLabel?: string
    badges?: readonly ImageListBadge[]
    /** missing 只影响灰显，不改变点击语义；不可点用 isDisabled 表达 */
    state?: 'normal' | 'missing'
    isDisabled?: boolean
    isBusy?: boolean
    isFailed?: boolean
    fallback?: { icon: ImageListIcon; label?: string }
    /** 图片解码后回报原始像素：上传页据此在角标里展示尺寸，非图片条目不会触发 */
    onMeasured?: (width: number, height: number) => void
    source: T
}

/** 悬停动作：统一排在卡片右下角竖列，按清单顺序自上而下 */
export interface ImageListAction<T> {
    key: string
    label: string
    icon: ImageListIcon
    variant?: 'ghost' | 'secondary' | 'destructive'
    isVisible?: (item: ImageListItem<T>) => boolean
    onTrigger: (item: ImageListItem<T>) => void
}

export interface ImageListGroup<T> {
    key: string
    label: string
    /** 该组总数，不等于分批后的已渲染数 */
    total: number
    items: readonly ImageListItem<T>[]
}

export type ImageListData<T> =
    { mode: 'flat'; items: readonly ImageListItem<T>[] } | { mode: 'grouped'; groups: readonly ImageListGroup<T>[] }

export interface ImageListEmptyState {
    title: string
    description?: string
    icon?: ImageListIcon
    action?: ReactNode
}

export interface ImageListStates {
    loadingLabel?: string
    /** skeleton 为首屏骨架卡，placeholder 为整块加载态 */
    loadingMode?: 'skeleton' | 'placeholder'
    emptyClassName?: string
    empty: ImageListEmptyState
    /** 库非空但筛选无结果；由 emptyPhase 选中使用 */
    noResult?: ImageListEmptyState
    error?: ImageListEmptyState
}

export type ImageListPaging =
    | { mode: 'none' }
    | { mode: 'button'; rendered: number; total: number; onLoadMore: () => void }
    | { mode: 'sentinel'; hasMore: boolean; isLoadingMore: boolean; onLoadMore: () => void }

export type ImageListProps<T> = ImageListData<T> & {
    columns?: ImageListColumns
    aspect?: ImageListAspect
    /** overlay 把说明压在图片底部，below 排在图片下方，none 不展示说明（左下角让给关联与操作条） */
    captionPlacement?: 'overlay' | 'below' | 'none'
    dimOnHover?: 'none' | 'light' | 'strong'
    isLoading?: boolean
    skeletonCount?: number
    /** 在途占位卡数量：排在首组首位，出图或插入回包后由真实卡片顶替 */
    pendingCount?: number
    errorText?: string | null
    emptyPhase?: 'empty' | 'no-result'
    states: ImageListStates
    paging: ImageListPaging
    isSelecting?: boolean
    selectedIds?: ReadonlySet<string>
    onActivate?: (item: ImageListItem<T>) => void
    onToggleSelect?: (item: ImageListItem<T>) => void
    actions?: readonly ImageListAction<T>[]
    /** 逃生舱：极端定制场景由调用方自行渲染卡片 */
    renderCard?: (item: ImageListItem<T>) => ReactNode
    className?: string
}

/** 宽高比类名：逐个写全字面量，动态拼接的类名 Tailwind 扫不到 */
export const IMAGE_LIST_ASPECT_CLASS: Readonly<Record<ImageListAspect, string>> = {
    '3/4': 'aspect-3/4',
    '4/3': 'aspect-4/3',
    square: 'aspect-square',
}

/** 栅格类名：紧凑为固定两列，响应式按容器宽度扩到三到四列 */
export const IMAGE_LIST_GRID_CLASS: Readonly<Record<ImageListColumns, string>> = {
    compact: 'grid grid-cols-2 gap-3',
    responsive: 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4',
}
