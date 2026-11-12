/**
 * 媒体页：作品与通用文档共用的唯一媒体入口，标题与筛选 + 按月分组网格 + 底部出图输入区。
 * 入口由工作流分区路由直接引用，文件名即组件名 WorkflowMedia，目录不提供 index 出口。
 * 复用约定：外壳取 @webview/components/AppPage，多选操作并进筛选行，强制重扫收进页头「更多操作」下拉菜单；
 * 列表走统一图片列表 ImageList，条目经 imageListAdapters 映射、年月分组取 hooks/mediaMonth，
 * 分批与筛选经 useImageFilters，图片动作用 useImageActions，关联刷新经 useMediaRescan。
 * 关键约束：context 为 null（笔记、公众号、普通文件）时仍可出图，但只出通用素材——不渲染作品摘要、
 * 不提供「设为作品封面」，角色图与条目图需要作品归属故不可选；本页不再承接上传；
 * 筛选为「年月 / 关联」两维，全部在内存完成，切换不重新请求；多选时选择操作覆盖整行、筛选区让位且不换行；
 * 卡片单击直接插入当前文档，详情 / 复制 / 删除收在右下角竖排悬停动作，引用标题在悬停左下角关联角标时按需读取；
 * 删除落盘侧进回收站，本页只刷新列表；
 * 出图成功只在该角色尚无封面时认领，取消后迟到的落盘只静默刷新列表。
 */
import { Copy, ImageIcon, Info, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import type { ImageGenerateResult } from '@shared/types/imagegen'
import type { MediaDetailResult, MediaItem } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { AppAction, AppContent, AppFooter, AppHeader, AppMenu, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { toMonthOptions } from './hooks/mediaMonth'
import { useCharacterCoverSync } from './hooks/useCharacterCoverSync'
import { useCharacterIndex, type ImageGenCharacter } from './hooks/useCharacterIndex'
import { useImageActions } from './hooks/useImageActions'
import { useImageDeletion } from './hooks/useImageDeletion'
import { useImageFilters } from './hooks/useImageFilters'
import { useImageLibrary } from './hooks/useImageLibrary'
import { useImageSelection } from './hooks/useImageSelection'
import { useImageSettings, type ImageSettingsPatch } from './hooks/useImageSettings'
import { useMediaRescan } from './hooks/useMediaRescan'
import { ImageComposer, type PromptSettingSnapshot } from './layout/ImageComposer'
import { ImageDetailDialog } from './layout/ImageDetailDialog'
import { ImageGenFilters } from './layout/ImageGenFilters'
import { ImageList } from './layout/imageList/ImageList'
import { toImageListGroups, toMediaItem } from './layout/imageList/imageListAdapters'
import { ImageSelectionActions } from './layout/ImageSelectionActions'
import type { ImageListAction, ImageListStates } from './layout/imageList/imageListModel'
import type { JSX } from 'react'

/** 作品上下文：有值时出图归属该作品并可设为作品封面；为 null 时是通用媒体库 */
export interface MediaContext {
    /** 当前作品目录：出图作用域与「设为作品封面」的目标 */
    dirPath: string
    /** 角色清单：出图提示词的角色段与卡片角标回查 */
    characters: ReadonlyArray<ImageGenCharacter>
    /** 设定条目清单：出图提示词的条目段与名称回查 */
    lore: ReadonlyArray<{ id: string; name: string }>
    /** 作品设定快照：「添加上下文」选中「作品设定」时展开为上下文段 */
    setting: PromptSettingSnapshot
    /** 写回人物卡封面指针：删除与生成后同步，保证角色卡页与本页一致 */
    onChangeCharacter: (characterId: string, patch: { coverPortraitId: string | null }) => void
}

interface WorkflowMediaProps {
    /** 作品上下文：非作品文档下为 null，页面退回通用媒体库形态 */
    context: MediaContext | null
}

/** 通用形态的空快照：设定段与角色段都不参与拼装，其余入口照常可用 */
const EMPTY_SETTING: PromptSettingSnapshot = {}
/** 通用形态的空角色清单：角色菜单为空，不影响参考图、规则与词条 */
const EMPTY_CHARACTERS: ReadonlyArray<ImageGenCharacter> = []
/** 通用形态没有人物卡可写回，封面同步整体空转 */
const ignoreCharacterPatch = (): void => undefined

/** 画廊状态位：整块加载态优先于两种空态，避免先闪一下「还没有图片」 */
const GALLERY_STATES: ImageListStates = {
    loadingMode: 'placeholder',
    loadingLabel: '正在读取图片',
    emptyClassName: 'flex-1 justify-center',
    empty: {
        title: '还没有图片',
        description: '在下方输入提示词生成第一张，或打开「作品封面」模式生成作品门面',
        icon: ImageIcon,
    },
    noResult: {
        title: '这个月没有图片',
        description: '切换到其他月份，或清空筛选查看全部',
        icon: ImageIcon,
    },
}

export function WorkflowMedia({ context }: WorkflowMediaProps): JSX.Element {
    const activeDirPath = context?.dirPath ?? null
    const characters = context?.characters ?? EMPTY_CHARACTERS
    const setting = context?.setting ?? EMPTY_SETTING
    const onChangeCharacter = context?.onChangeCharacter ?? ignoreCharacterPatch
    const { items, months, total, isLoading, removeMedia, removeMedias, reload } = useImageLibrary()
    /** 静默刷新：重扫与出图回填都只换数据，不把整页打回「正在读取」 */
    const silentReload = useCallback((): Promise<void> => reload({ silent: true }), [reload])
    /** 关联刷新：挂载时按节流扫描一次，菜单入口强制重扫 */
    const { rescan } = useMediaRescan(silentReload)
    const { settings, isLoaded: isSettingsLoaded, save: saveSettings } = useImageSettings()
    const {
        month,
        setMonth,
        link,
        setLink,
        filtered,
        visibleGroups,
        hasActiveFilter,
        clearFilters,
        filterSignature,
        loadMore,
    } = useImageFilters({ items })

    /** 角色索引：封面指针修正与出图认领都按 id 查，省去多处线性查找 */
    const { byId: charactersById } = useCharacterIndex(characters)

    /** 年月下拉选项：全部月份排首位，其余按年月倒序 */
    const monthOptions = useMemo(() => toMonthOptions(months, total), [months, total])

    /** 详情弹窗当前查看的图片：null 表示未打开 */
    const [selected, setSelected] = useState<MediaItem | null>(null)
    /**
     * 有在途出图请求：列表首位挂一张骨架占位，出图成功后由 reload 回来的真实图片顶替。
     * 状态由 composer 上报，失败与取消同样会回收，不会把占位留在列表里。
     */
    const [isGenerating, setIsGenerating] = useState(false)
    /**
     * 出图已回但列表还没刷回来：占位继续挂着，让「骨架 → 新图」只替换一次。
     * 配合静默刷新，中间不会闪一下「正在读取图片」的整块加载态。
     */
    const [isRefreshingResult, setIsRefreshingResult] = useState(false)

    /** 图片动作：设封面、复制、插入都由 hook 持有，插入收尾时收起详情面板 */
    const { setImageCover, copyImage, insertImage } = useImageActions({
        // 无作品上下文时没有设封面入口，空串只作占位，不会走到宿主
        dirPath: activeDirPath ?? '',
        reload,
        onDetailClose: () => {
            setSelected(null)
        },
    })

    /** 已渲染的图片：全选与网格都只覆盖这一批，未加载的图不进批量操作 */
    const visibleItems = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups])

    /**
     * 引用标题按需读取：列表接口只带引用条数，标题在悬停关联角标时才查详情，
     * 每条引用取标题，缺失时退回路径。
     */
    const loadUsageTitles = useCallback(async (id: string): Promise<readonly string[]> => {
        const detail = await request<MediaDetailResult>('media/detail', { id })
        return detail.usages.map((usage) => usage.refTitle ?? usage.refPath)
    }, [])

    /** 统一列表的分组数据：领域条目与出处标签由适配器折算，组件层不认识媒体字段 */
    const galleryGroups = useMemo(
        () => toImageListGroups(visibleGroups, (image) => toMediaItem(image, {}, loadUsageTitles)),
        [visibleGroups, loadUsageTitles],
    )

    /** 多选与删除编排：多选只在当前筛选内生效，删除后由封面同步 hook 修正角色指针 */
    const { isSelecting, selectedIds, isAllVisibleSelected, toggleSelecting, exitSelecting, toggleImage, selectAll } =
        useImageSelection({ visibleItems, filterSignature })

    const { claimOnGenerated, applyDeleteFallbacks, syncAfterBatchDelete } = useCharacterCoverSync({
        charactersById,
        onChangeCharacter,
    })

    const { removingTotal, isConfirmingBatch, deleteOne, requestConfirm, closeConfirm, confirmBatch } =
        useImageDeletion({
            removeMedia,
            removeMedias,
            filtered,
            selectedIds,
            exitSelecting,
            detailImage: selected,
            onDetailRemoved: () => {
                setSelected(null)
            },
            // 条目封面回退需要条目页的写回入口，本页只处理角色封面；条目数据原样忽略
            onCoverFallbacks: (characterFallbacks) => {
                applyDeleteFallbacks(characterFallbacks)
            },
            syncAfterBatchDelete,
        })

    /** 库里一张图都没有：空态文案与标题行张数徽标共用同一判断 */
    const isLibraryEmpty = items.length === 0

    /** 标题行张数：空库不展示，避免「共 0 张」与空态文案重复 */
    const totalText = isLibraryEmpty ? undefined : `共 ${total.toLocaleString('zh-CN')} 张`

    /** 比例与画风改动：只上报改动项，落盘与回显一律以宿主返回的真实状态为准 */
    const handleSettingsChange = (patch: ImageSettingsPatch): void => {
        void saveSettings(patch)
    }

    /**
     * 出图成功：先静默刷新列表，再按「该角色尚无封面」认领角色封面。
     * 认领对象取结果图自身的 characterId，与顶栏筛选解耦；通用形态下没有角色索引，认领自然空转。
     */
    const handleGenerated = (result: ImageGenerateResult): void => {
        setIsRefreshingResult(true)
        void reload({ silent: true }).finally(() => {
            setIsRefreshingResult(false)
        })
        claimOnGenerated(result.image)
    }

    /** 取消后迟到的落盘：只静默补列表，不认领封面，也不动筛选与选中集合 */
    const handleLateGenerated = (): void => {
        void reload({ silent: true })
    }

    /** 单张删除的同步入口：网格与详情面板传的都是这个，Promise 在内部收口 */
    const deleteImage = (image: MediaItem): void => {
        void deleteOne(image)
    }

    /** 详情面板开关：关闭时清掉选中图片，图片本身由面板自身控制 */
    const handleDetailOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setSelected(null)
        }
    }

    /** 二次确认开关：打开由标题行触发，关闭一律回到未确认态 */
    const handleConfirmingChange = (isOpen: boolean): void => {
        if (!isOpen) {
            closeConfirm()
        }
    }

    /** 卡片悬停动作：右下角竖排依次是详情 / 复制 / 删除，单击卡片本身直接插入当前文档 */
    const mediaActions: ImageListAction<MediaItem>[] = [
        {
            key: 'detail',
            label: '查看详情',
            icon: Info,
            onTrigger: (item) => setSelected(item.source),
        },
        {
            key: 'copy',
            label: '复制图片',
            icon: Copy,
            onTrigger: (item) => copyImage(item.source),
        },
        {
            key: 'delete',
            label: '删除图片',
            icon: Trash2,
            variant: 'destructive',
            onTrigger: (item) => deleteImage(item.source),
        },
    ]

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>媒体</AppTitle>
                    <AppAction>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" tooltip="更多操作" aria-label="更多操作">
                                    <MoreHorizontal className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={rescan}>
                                    <RefreshCw className="size-4" />
                                    重新扫描关联
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </AppAction>
                    {context === null ? null : (
                        <AppSummary title={setting.title} path={context.dirPath} meta={totalText} />
                    )}
                    <AppMenu className={isSelecting ? 'flex-nowrap justify-end' : 'justify-between'}>
                        {isSelecting ? null : (
                            <ImageGenFilters
                                month={month}
                                options={monthOptions}
                                onMonthChange={setMonth}
                                link={link}
                                onLinkChange={setLink}
                                hasActiveFilter={hasActiveFilter}
                                onClearFilters={clearFilters}
                            />
                        )}
                        <div
                            className={isSelecting ? 'flex w-full items-center justify-end' : 'flex items-center gap-1'}
                        >
                            <ImageSelectionActions
                                isSelecting={isSelecting}
                                selectedCount={selectedIds.size}
                                visibleCount={visibleItems.length}
                                isAllVisibleSelected={isAllVisibleSelected}
                                removingTotal={removingTotal}
                                onToggleSelecting={toggleSelecting}
                                onSelectAll={selectAll}
                                onRequestDelete={requestConfirm}
                            />
                        </div>
                    </AppMenu>
                </AppHeader>
                <AppContent isScrollable>
                    <ImageList
                        mode="grouped"
                        groups={galleryGroups}
                        columns="responsive"
                        aspect="3/4"
                        captionPlacement="none"
                        dimOnHover="light"
                        isLoading={isLoading}
                        pendingCount={isGenerating || isRefreshingResult ? 1 : 0}
                        emptyPhase={isLibraryEmpty ? 'empty' : 'no-result'}
                        states={GALLERY_STATES}
                        paging={{
                            mode: 'button',
                            rendered: visibleItems.length,
                            total: filtered.length,
                            onLoadMore: loadMore,
                        }}
                        isSelecting={isSelecting}
                        selectedIds={selectedIds}
                        onActivate={(item) => insertImage(item.source)}
                        onToggleSelect={(item) => toggleImage(item.source)}
                        actions={mediaActions}
                    />
                </AppContent>
                {/* 出图输入区常驻底部：竖排撑满宽度，参数读完与否的占位差异由 composer 内部承担 */}
                <AppFooter>
                    <ImageComposer
                        isLoaded={isSettingsLoaded}
                        dirPath={activeDirPath}
                        characters={characters}
                        setting={setting}
                        initialCharacterId={null}
                        defaultRatio={settings.defaultRatio}
                        defaultStyle={settings.portraitStyle}
                        onSettingsChange={handleSettingsChange}
                        onGenerated={handleGenerated}
                        onLateGenerated={handleLateGenerated}
                        onGeneratingChange={setIsGenerating}
                    />
                </AppFooter>
            </AppPage>

            {/* 单图详情：点缩略图打开，展示出处与引用；作品上下文下可设为封面 */}
            <ImageDetailDialog
                image={selected}
                onOpenChange={handleDetailOpenChange}
                onSetCover={context === null ? undefined : setImageCover}
                onCopyImage={copyImage}
                onInsertImage={insertImage}
                onDelete={deleteImage}
            />

            <ConfirmDialog
                open={isConfirmingBatch}
                title={`删除选中的 ${String(selectedIds.size)} 张图片？`}
                description="文件会移入系统回收站；被作品封面、章节或笔记引用的图片，正文章节中的图片链接将失效。"
                confirmLabel="删除选中"
                isDestructive
                size="sm"
                onOpenChange={handleConfirmingChange}
                onConfirm={confirmBatch}
            />
        </>
    )
}
