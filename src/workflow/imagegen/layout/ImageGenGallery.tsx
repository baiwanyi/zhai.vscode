/**
 * 生图页画廊区：在 AppContent 内呈现读取中的加载态、两种空态、图片网格与「加载更多」入口。
 * 有在途结果时网格首位挂一张骨架占位，出图后由真实图片顶替，是全页唯一的「生成中」视觉反馈。
 * 复用约定：空态取 @webview/components/StateEmpty，网格取本目录 ImageGenGrid，
 * 加载更多按钮取 @webview/components/Button，图片类型取 @shared/types/imagegen。
 * 关键约束：本组件不产生包裹节点（返回 Fragment），空态因此仍是 AppContent 的直接弹性子元素，
 * 居中布局不被破坏；只渲染调用方给定的这一批图片，分批与全选口径由页面持有，此处不做切片；
 * 空态文案只由 isLibraryEmpty 二选一，不看筛选细节；进度分子取已渲染张数，达到筛选结果即不再出现入口。
 */
import { ImageIcon } from 'lucide-react'
import type { PressImageItem } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { ImageGenGrid } from './ImageGenGrid'
import type { JSX } from 'react'

/** 空态与加载态占满滚动区并纵向居中：共用同一槽位样式，两者互切时位置不跳动 */
const FILL_SLOT_CLASS = 'flex-1 justify-center'

/** 加载中文案：title 在加载态不渲染，可见文案由 loadingLabel 承担，两处同值防文案漂移 */
const LOADING_LABEL = '正在读取图片'

interface ImageGenGalleryProps {
    /** 列表读取中：优先于空态展示，避免先闪一下「还没有图片」 */
    isLoading: boolean
    /**
     * 有在途结果：出图请求进行中，或请求已完成但列表还没刷回来。
     * 期间列表首位挂一张骨架占位，出图后由真实图片顶替；库里一张图都没有时也走网格，
     * 否则用户点完生成看到的仍是空态，像没点上。
     */
    isPending: boolean
    /** 库里一张图都没有：仅用于区分两种空态文案，与当前筛选无关 */
    isLibraryEmpty: boolean
    /** 当前筛选结果张数：为 0 时走空态，否则作为加载更多的分母 */
    filteredTotal: number
    /** 已渲染的图片：分批挂载的结果，网格与进度分子只看这一批 */
    visibleImages: PressImageItem[]
    /** 作品封面当前指向的图片 id */
    coverSelectedId: string | null
    /** 角色 id → 名称：用于卡片角标，缺失时不显示 */
    characterNames: ReadonlyMap<string, string>
    /** 多选模式：点击卡片切换选中，不再打开详情 */
    isSelecting: boolean
    /** 已选中的图片路径集合 */
    selectedPaths: ReadonlySet<string>
    onToggleSelect: (image: PressImageItem) => void
    onDelete: (image: PressImageItem) => void
    onCopy: (image: PressImageItem) => void
    onInsert: (image: PressImageItem) => void
    /** 点击卡片查看详情：由页面决定详情的呈现形式 */
    onSelect: (image: PressImageItem) => void
    /** 追加下一批：分页状态由页面持有 */
    onLoadMore: () => void
}

export function ImageGenGallery({
    isLoading,
    isPending,
    isLibraryEmpty,
    filteredTotal,
    visibleImages,
    coverSelectedId,
    characterNames,
    isSelecting,
    selectedPaths,
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
                title={isLibraryEmpty ? '还没有图片' : '没有符合条件的图片'}
                description={
                    isLibraryEmpty
                        ? '在下方输入提示词生成第一张，或打开「作品封面」模式生成作品门面'
                        : '换个筛选条件或清空筛选再试'
                }
                icon={ImageIcon}
                className={FILL_SLOT_CLASS}
            />
        )
    }

    /** 还有未渲染的图片：分母是筛选结果而非全部图片，筛选变窄后入口自然消失 */
    const hasMore = visibleImages.length < filteredTotal

    return (
        <>
            <ImageGenGrid
                images={visibleImages}
                pendingCount={isPending ? 1 : 0}
                coverSelectedId={coverSelectedId}
                characterNames={characterNames}
                isSelecting={isSelecting}
                selectedPaths={selectedPaths}
                onToggleSelect={onToggleSelect}
                onDelete={onDelete}
                onCopy={onCopy}
                onInsert={onInsert}
                onSelect={onSelect}
            />
            {hasMore ? (
                <div className="flex justify-center px-4 pb-4">
                    <Button size="sm" variant="outline" onClick={onLoadMore}>
                        加载更多（{visibleImages.length} / {filteredTotal}）
                    </Button>
                </div>
            ) : null}
        </>
    )
}
