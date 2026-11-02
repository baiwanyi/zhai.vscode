/**
 * 媒体库页（非作品上下文）：给笔记、公众号文章与其它文档提供一个能看、能插图的图片库。
 * 复用约定：数据与删除取 workflow/imagegen 的 useImageLibrary，年月分组与分批取 useImageFilters，
 * 网格取 imagegen 的 ImageGenGrid，动作（插入/复制）复用 useImageActions，
 * 外壳取 components/AppPage，空态取 components/StateEmpty。
 * 关键约束：插入写的是当前活动 Markdown 编辑器的光标处，本页不校验文档归属——宿主会拒绝非 Markdown 与未保存文档；
 * 不提供出图与「设为作品封面」：那两项以作品上下文为前提，仍在作品的媒体分区里；
 * 点击卡片与悬停按钮都执行插入，删除落回收站后重新列举，不做乐观删减。
 */
import { Image as ImageIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { MediaItem } from '@shared/types/media'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { JSX } from 'react'
import { useImageActions } from '../imagegen/hooks/useImageActions'
import { useImageFilters } from '../imagegen/hooks/useImageFilters'
import { useImageLibrary } from '../imagegen/hooks/useImageLibrary'
import { ImageGenGrid } from '../imagegen/layout/ImageGenGrid'

/** 空选中集合：本页不提供多选，网格据此不渲染勾选态 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

/** 分组头：吸顶显示年月与张数，与作品媒体页同一口径 */
const GROUP_HEADER_CLASS =
    'bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur'

export function MediaLibraryPage(): JSX.Element {
    const { items, total, isLoading, reload, removeMedia } = useImageLibrary()
    const { visibleGroups, hasMore, loadMore } = useImageFilters({ items })
    // 不传作品目录：本页没有「设为封面」入口，动作只用到插入与复制
    const { insertImage, copyImage } = useImageActions({
        dirPath: '',
        reload,
        onDetailClose: () => undefined,
    })

    /** 删除：宿主落回收站后整页重拉，失败已在 hook 内提示 */
    const handleDelete = (image: MediaItem): void => {
        void removeMedia(image)
    }

    const isEmpty = !isLoading && items.length === 0
    const description = useMemo(
        () => (isEmpty ? '还没有图片' : `${String(total)} 张图片 · 点击卡片插入到当前文章`),
        [isEmpty, total],
    )

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>媒体</AppTitle>
                <AppDescription>{description}</AppDescription>
            </AppHeader>
            <AppContent isScrollable>
                {isEmpty ? (
                    <StateEmpty
                        title="图库还是空的"
                        description="到作品的媒体分区生成图片，或把已有图片放进文档保存目录的 images 目录后再回来。"
                        icon={ImageIcon}
                    >
                        <Button variant="outline" onClick={() => void reload()}>
                            刷新
                        </Button>
                    </StateEmpty>
                ) : (
                    visibleGroups.map((group) => (
                        <section key={group.month} className="flex flex-col gap-2 pb-3">
                            <h3 className={GROUP_HEADER_CLASS}>{`${group.label} · ${String(group.total)} 张`}</h3>
                            <ImageGenGrid
                                images={group.items}
                                pendingCount={0}
                                isSelecting={false}
                                selectedIds={EMPTY_SELECTION}
                                onToggleSelect={() => undefined}
                                onDelete={handleDelete}
                                onCopy={copyImage}
                                onInsert={insertImage}
                                onSelect={insertImage}
                            />
                        </section>
                    ))
                )}
                {hasMore && (
                    <Button variant="outline" className="mt-2 w-full" onClick={loadMore}>
                        加载更多
                    </Button>
                )}
            </AppContent>
            <AppFooter>
                <Button variant="outline" disabled={isLoading} onClick={() => void reload()}>
                    刷新
                </Button>
            </AppFooter>
        </AppPage>
    )
}
