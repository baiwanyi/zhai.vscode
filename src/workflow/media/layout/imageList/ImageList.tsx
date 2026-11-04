/**
 * 统一图片列表：编排加载态、空态、按月分组或平铺网格、在途占位与续载入口，供媒体、图库与上传页共用。
 * 复用约定：状态位、骨架、分组头与续载入口各由同族组件承担，卡片取 ImageCard，
 * 网格容器取 @components/ui 的 ItemGroup；数据为 flat / grouped 二选一的受控输入。
 * 关键约束：状态优先级固定为「加载 → 错误 → 空 → 内容」，加载态与空态不产生包裹节点，
 * 保证空态仍是 AppContent 的直接弹性子元素；列表不发起请求、不持有筛选与删除状态。
 */
import { cn } from 'cn'
import { Fragment } from 'react'
import { ItemGroup } from '@components/ui/item'
import { ImageCard } from './ImageCard'
import { ImageListEmpty } from './ImageListEmpty'
import { ImageListGroup } from './ImageListGroup'
import { ImageListLoadMore } from './ImageListLoadMore'
import { IMAGE_LIST_GRID_CLASS } from './imageListModel'
import { ImageListSkeleton } from './ImageListSkeleton'
import type { ImageListItem, ImageListProps } from './imageListModel'
import type { JSX } from 'react'

export function ImageList<T>(props: ImageListProps<T>): JSX.Element {
    const {
        columns = 'compact',
        aspect = '4/3',
        groupUnit = '张',
        captionPlacement = 'overlay',
        dimOnHover = 'none',
        isLoading = false,
        skeletonCount = 6,
        pendingCount = 0,
        errorText = null,
        emptyPhase = 'empty',
        states,
        paging,
        isSelecting = false,
        selectedIds,
        onActivate,
        onToggleSelect,
        actions,
        renderCard,
        className,
    } = props

    const items: readonly ImageListItem<T>[] =
        props.mode === 'flat' ? props.items : props.groups.flatMap((group) => group.items)
    const isLoadingFirst = isLoading && (states.loadingMode === 'placeholder' || items.length === 0)
    const isEmpty = items.length === 0 && pendingCount === 0

    if (isLoadingFirst) {
        return states.loadingMode === 'placeholder' ? (
            <ImageListEmpty phase="loading" states={states} />
        ) : (
            <ImageListSkeleton count={skeletonCount} columns={columns} aspect={aspect} />
        )
    }
    if (errorText !== null) {
        return <ImageListEmpty phase="error" states={states} errorText={errorText} />
    }
    if (isEmpty) {
        return <ImageListEmpty phase={emptyPhase === 'no-result' ? 'no-result' : 'empty'} states={states} />
    }

    const gridClass = cn(IMAGE_LIST_GRID_CLASS[columns], props.mode === 'grouped' ? 'pt-2' : 'pt-1')
    const pendingCards = Array.from({ length: pendingCount }, (_, index) => (
        <ImageListSkeleton
            key={`image-list-pending-${String(index)}`}
            variant="card"
            columns={columns}
            aspect={aspect}
        />
    ))

    const renderItem = (item: ImageListItem<T>): JSX.Element => (
        <Fragment key={item.id}>
            {renderCard === undefined ? (
                <ImageCard
                    item={item}
                    aspect={aspect}
                    captionPlacement={captionPlacement}
                    dimOnHover={dimOnHover}
                    isSelecting={isSelecting}
                    isSelected={selectedIds?.has(item.id) ?? false}
                    actions={actions}
                    onActivate={onActivate}
                    onToggleSelect={onToggleSelect}
                />
            ) : (
                renderCard(item)
            )}
        </Fragment>
    )

    return (
        <div className={cn('mb-3', className)}>
            {props.mode === 'grouped' ? (
                props.groups.map((group, index) => (
                    <ImageListGroup key={group.key} label={group.label} total={group.total} unit={groupUnit}>
                        <ItemGroup className={gridClass}>
                            {index === 0 ? pendingCards : null}
                            {group.items.map(renderItem)}
                        </ItemGroup>
                    </ImageListGroup>
                ))
            ) : (
                <ItemGroup className={gridClass}>
                    {pendingCards}
                    {items.map(renderItem)}
                </ItemGroup>
            )}
            {/* 库里还没有分组但有在途结果：单独挂一组占位，避免点完生成看到的仍是空态 */}
            {props.mode === 'grouped' && props.groups.length === 0 && pendingCount > 0 ? (
                <ItemGroup className={gridClass}>{pendingCards}</ItemGroup>
            ) : null}
            <ImageListLoadMore paging={paging} observeKey={items.length} />
        </div>
    )
}
