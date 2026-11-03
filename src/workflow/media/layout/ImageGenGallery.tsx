/**
 * 媒体页画廊区：在 AppContent 内呈现读取中的加载态、两种空态、按月分组网格与「加载更多」入口。
 * 有在途结果时第一组首位挂一张骨架占位，出图后由真实图片顶替，是全页唯一的「生成中」视觉反馈。
 * 复用约定：空态取 @webview/components/StateEmpty，网格取本目录 ImageGenGrid，
 * 加载更多按钮取 @webview/components/Button，分组结构取 useImageFilters 的 MediaGroup。
 * 关键约束：本组件不产生包裹节点（返回 Fragment），空态因此仍是 AppContent 的直接弹性子元素，
 * 居中布局不被破坏；只渲染调用方给定的这一批图片，分批与全选口径由页面持有，此处不做切片；
 * 分组头 sticky 吸顶，跨月滚动时始终能看到当前月份；分组内张数取该组总数而不是已渲染数。
 */
import { ImageIcon } from 'lucide-react'
import type { MediaItem } from '@shared/types/media'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { ImageGenGrid } from './ImageGenGrid'
import type { MediaGroup } from '../hooks/useImageFilters'
import type { JSX } from 'react'

/** 空态与加载态占满滚动区并纵向居中：共用同一槽位样式，两者互切时位置不跳动 */
const FILL_SLOT_CLASS = 'flex-1 justify-center'

/** 加载中文案：title 在加载态不渲染，可见文案由 loadingLabel 承担，两处同值防文案漂移 */
const LOADING_LABEL = '正在读取图片'

/** 分组头：吸顶显示年月与张数，滚动时始终能定位当前月份 */
const GROUP_HEADER_CLASS =
    'bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur'

interface ImageGenGalleryProps {
    /** 列表读取中：优先于空态展示，避免先闪一下「还没有图片」 */
    isLoading: boolean
    /**
     * 有在途结果：出图请求进行中，或请求已完成但列表还没刷回来。
     * 期间第一组首位挂一张骨架占位，出图后由真实图片顶替；库里一张图都没有时也走网格，
     * 否则用户点完生成看到的仍是空态，像没点上。
     */
    isPending: boolean
    /** 库里一张图都没有：仅用于区分两种空态文案，与当前筛选无关 */
    isLibraryEmpty: boolean
    /** 当前筛选结果张数：为 0 时走空态，否则作为加载更多的分母 */
    filteredTotal: number
    /** 按月分组后的图片：分批挂载的结果，网格与进度分子只看这一批 */
    groups: ReadonlyArray<MediaGroup>
    /** 是否还有未渲染的图片 */
    hasMore: boolean
    /** 多选模式：点击卡片切换选中，不再打开详情 */
    isSelecting: boolean
    /** 已选中的媒体 id 集合 */
    selectedIds: ReadonlySet<string>
    onToggleSelect: (image: MediaItem) => void
    onDelete: (image: MediaItem) => void
    onCopy: (image: MediaItem) => void
    onInsert: (image: MediaItem) => void
    /** 点击卡片查看详情：由页面决定详情的呈现形式 */
    onSelect: (image: MediaItem) => void
    /** 追加下一批：分页状态由页面持有 */
    onLoadMore: () => void
}

export function ImageGenGallery({
    isLoading,
    isPending,
    isLibraryEmpty,
    filteredTotal,
    groups,
    hasMore,
    isSelecting,
    selectedIds,
    onToggleSelect,
    onDelete,
    onCopy,
    onInsert,
    onSelect,
    onLoadMore,
}: ImageGenGalleryProps): JSX.Element {
    if (isLoading) {
        return <StateEmpty title={LOADING_LABEL} isLoading loadingLabel={LOADING_LABEL} className={FILL_SLOT_CLASS} />
    }

    // 有在途结果时即使筛选结果为 0 也走网格：占位卡本身就说明了「有一张在路上」
    if (filteredTotal === 0 && !isPending) {
        return (
            <StateEmpty
                title={isLibraryEmpty ? '还没有图片' : '这个月没有图片'}
                description={
                    isLibraryEmpty
                        ? '在下方输入提示词生成第一张，或打开「作品封面」模式生成作品门面'
                        : '切换到其他月份，或清空筛选查看全部'
                }
                icon={ImageIcon}
                className={FILL_SLOT_CLASS}
            />
        )
    }

    /** 已渲染张数：加载更多的分子，达到筛选结果即不再出现入口 */
    const renderedCount = groups.reduce((sum, group) => sum + group.items.length, 0)

    return (
        <div className="mb-3">
            {groups.map((group, index) => (
                <section key={group.month} aria-label={group.label}>
                    <div className={GROUP_HEADER_CLASS}>
                        {group.label}
                        <span className="ml-1.5 tabular-nums">· {group.total} 张</span>
                    </div>
                    <ImageGenGrid
                        images={group.items}
                        pendingCount={isPending && index === 0 ? 1 : 0}
                        isSelecting={isSelecting}
                        selectedIds={selectedIds}
                        onToggleSelect={onToggleSelect}
                        onDelete={onDelete}
                        onCopy={onCopy}
                        onInsert={onInsert}
                        onSelect={onSelect}
                    />
                </section>
            ))}
            {hasMore ? (
                <div className="flex justify-center px-4 pb-4">
                    <Button size="sm" variant="outline" onClick={onLoadMore}>
                        加载更多（{renderedCount} / {filteredTotal}）
                    </Button>
                </div>
            ) : null}
        </div>
    )
}
