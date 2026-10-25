/**
 * 生图页：以 app-page 骨架承载「标题与筛选区 + 图片网格 + 底部出图输入区」。
 * 复用约定：外壳取 @webview/components/AppPage（多选操作并进标题行 AppAction，
 * 筛选区整行走 AppMenu，网格走 AppContent 滚动，composer 落 AppFooter），
 * 列表经 useImageLibrary、参数经 useImageSettings、筛选与分批经 useImageFilters、图片动作用 useImageActions，
 * 加载态/空态/网格/加载更多由 ImageGenGallery 渲染，单图详情交由 ImageDetailDialog、
 * 多选操作交由 ImageSelectionActions、类型与角色筛选交由 ImageGenFilters，
 * 张数徽标占标题行右侧、作品名占说明行。
 * 关键约束：筛选只有角色与图片类别两个维度（图片体量有限，不另设关键词搜索），全部在内存中完成；
 * 「作品封面」是筛选维度而非图片类别，由 coverSelectedId 与图片 id 比较得出；
 * 删除落盘侧进回收站，本节只刷新列表，批量删除后按剩余列表修正角色封面指针；
 * 参数读完前 composer 只渲染同高骨架，出图成功只在该角色尚无封面时认领，取消后迟到的落盘只静默刷新列表；
 * 出图期间与回包后的刷新窗口内，列表首位都保留骨架占位，成功后静默刷新，占位直接由新图顶替；
 * 全选只覆盖已渲染图片；选中集合与分批上限都与筛选签名绑定，换筛选即自然复位。
 */
import { useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import type { ImageGenerateResult, PressImageItem } from '@shared/types/imagegen'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { useImageActions } from './hooks/useImageActions'
import { useImageFilters } from './hooks/useImageFilters'
import { useImageLibrary } from './hooks/useImageLibrary'
import { useImageSettings, type ImageSettingsPatch } from './hooks/useImageSettings'
import { ImageComposer, type PromptCharacterSnapshot, type PromptSettingSnapshot } from './layout/ImageComposer'
import { ImageDetailDialog } from './layout/ImageDetailDialog'
import { ImageGenFilters } from './layout/ImageGenFilters'
import { ImageGenGallery } from './layout/ImageGenGallery'
import { ImageSelectionActions } from './layout/ImageSelectionActions'
import type { JSX } from 'react'

/** 空选中集合：筛选切换后的派生值复用它，避免每次渲染新建对象 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

/** 生图页角色快照：提示词所需字段之外再补一份封面指针，用于删除与生成后的指针同步 */
interface ImageGenCharacter extends PromptCharacterSnapshot {
    coverPortraitId: string | null
}

interface ImageGenPageProps {
    /** 当前作品目录：既是数据作用域，也是切换作品时的重建依据 */
    dirPath: string
    /**
     * 角色清单：用于人物筛选、卡片角标、封面指针修复与提示词里的角色段。
     * 只取人物卡里与出图相关的几项，不整体透传，避免页面耦合人物卡的全部字段。
     */
    characters: ReadonlyArray<ImageGenCharacter>
    /** 作品设定快照：命令动作选中「作品设定」时展开进提示词 */
    setting: PromptSettingSnapshot
    /** 写回人物卡封面指针：删除与生成后同步，保证角色卡页与本页一致 */
    onChangeCharacter: (characterId: string, patch: { coverPortraitId: string | null }) => void
}

export function ImageGenPage({ dirPath, characters, setting, onChangeCharacter }: ImageGenPageProps): JSX.Element {
    const { images, coverSelectedId, counts, isLoading, removeImage, removeImages, reload } = useImageLibrary(dirPath)
    const { settings, isLoaded: isSettingsLoaded, save: saveSettings } = useImageSettings(dirPath)
    const {
        kind,
        setKind,
        characterId,
        setCharacterId,
        activeCharacterId,
        filtered,
        kindCounts,
        hasActiveFilter,
        clearFilters,
        filterSignature,
        visibleImages,
        loadMore,
    } = useImageFilters({ images, counts, coverSelectedId })

    /** 详情弹窗当前查看的图片：null 表示未打开 */
    const [selected, setSelected] = useState<PressImageItem | null>(null)
    /** 多选模式：点击卡片切换选中，不打开详情 */
    const [isSelecting, setIsSelecting] = useState(false)
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
    /**
     * 选中集合与产生它的筛选签名绑定：换筛选后派生为空集，不必在每处筛选回调里手动清空，
     * 也就不会出现「已选 N 张」与实际可见图片对不上的情况。
     */
    const [selection, setSelection] = useState<{ signature: string; paths: ReadonlySet<string> }>({
        signature: '',
        paths: EMPTY_SELECTION,
    })
    /** 批量删除中的张数：非空表示正在删除，同时用于禁用重复触发 */
    const [removingTotal, setRemovingTotal] = useState<number | null>(null)
    /** 批量删除的二次确认：与单张删除不同，一次删多张更需要拦一下 */
    const [isConfirmingBatch, setIsConfirmingBatch] = useState(false)

    /** 图片动作：设封面、复制、插入都由 hook 持有，插入收尾时收起详情面板 */
    const { setImageCover, copyImage, insertImage } = useImageActions({
        dirPath,
        reload,
        onDetailClose: () => {
            setSelected(null)
        },
    })

    /** 库里一张图都没有：空态文案与标题行张数徽标共用同一判断，避免两处各写一遍长度比较 */
    const isLibraryEmpty = images.length === 0

    /** 角色索引：封面指针修正与出图认领都按 id 查，省去多处线性查找 */
    const charactersById = useMemo(
        () => new Map(characters.map((character) => [character.id, character])),
        [characters],
    )

    /** 卡片角标用的角色 id → 姓名 */
    const characterNames = useMemo(
        () => new Map(characters.map((character) => [character.id, character.name])),
        [characters],
    )

    /** 当前生效的选中集合：签名与当前筛选不一致即视为空，避免残留上一组筛选的勾选 */
    const selectedPaths = selection.signature === filterSignature ? selection.paths : EMPTY_SELECTION

    /** 全选状态：已选与已渲染张数相等且确实渲染出了图片，按全选与否决定下一步 */
    const isAllVisibleSelected = visibleImages.length > 0 && selectedPaths.size === visibleImages.length

    /** 写入选中集合时一并记下当前筛选签名，供上面的派生判断使用 */
    const updateSelection = (next: ReadonlySet<string>): void => {
        setSelection({ signature: filterSignature, paths: next })
    }

    /** 进入或退出多选：两个方向都清空已选，避免下次进入时残留上次的勾选 */
    const handleToggleSelecting = (): void => {
        setIsSelecting((current) => !current)
        updateSelection(EMPTY_SELECTION)
    }

    const toggleSelectImage = (image: PressImageItem): void => {
        const next = new Set(selectedPaths)
        if (next.has(image.path)) {
            next.delete(image.path)
        } else {
            next.add(image.path)
        }
        updateSelection(next)
    }

    /** 全选只覆盖已渲染的图片：未加载的图不在视野里，不该被批量删除带走 */
    const handleSelectAll = (): void => {
        updateSelection(isAllVisibleSelected ? EMPTY_SELECTION : new Set(visibleImages.map((image) => image.path)))
    }

    /**
     * 删除图片并同步角色封面：宿主已算好回退值，此处只在「被删图正是该角色当前封面」时写回，
     * 避免把已经被用户改过的封面又覆盖回去。
     */
    const handleDelete = async (image: PressImageItem): Promise<void> => {
        const result = await removeImage(image)
        // 删掉的可能正是详情面板里的那张，面板随之关闭，避免停留在一个已不存在的文件上
        if (selected !== null && selected.path === image.path) {
            setSelected(null)
        }
        if (result === null || !result.removed || result.characterId === null) {
            return
        }
        const target = charactersById.get(result.characterId)
        if (target === undefined || target.coverPortraitId !== image.id) {
            return
        }
        onChangeCharacter(result.characterId, { coverPortraitId: result.nextPortraitId })
    }

    /**
     * 批量删除：一次提交后按剩余列表修正角色封面指针。
     * 关键约束：只有「被删的正是该角色当前封面」才改指针，且回退值取剩余列表里该角色最新一张，
     * 不直接采用宿主单张回执的 nextPortraitId——同批里它可能指向马上要被删掉的图；
     * 提交期间置 removing 防重入，并逐张回推进度，避免长批次看起来像卡死。
     */
    const handleDeleteSelected = async (): Promise<void> => {
        if (removingTotal !== null) {
            return
        }
        // 只删当前筛选结果内的勾选：勾选可能发生在更早的筛选下，不应波及此刻不可见的图
        const targets = filtered.filter((image) => selectedPaths.has(image.path))
        if (targets.length === 0) {
            return
        }
        setRemovingTotal(targets.length)
        try {
            const { removals, images: remaining } = await removeImages(targets)
            const removed = removals.filter((item) => item.removed).map((item) => item.image)
            /** 已删图 id 集合：面板关闭判断与封面指针判断都要反复命中，先收成集合避免重复扫描 */
            const removedIds = new Set(removed.map((image) => image.id))
            if (selected !== null && removedIds.has(selected.id)) {
                setSelected(null)
            }
            // 请求级失败（removals 为空）时保留多选与勾选，用户可直接重试
            if (removals.length > 0) {
                setIsSelecting(false)
                updateSelection(EMPTY_SELECTION)
            }
            const affectedCharacterIds = new Set(
                removed.flatMap((image) => (image.characterId === null ? [] : [image.characterId])),
            )
            for (const targetId of affectedCharacterIds) {
                const target = charactersById.get(targetId)
                if (
                    target === undefined ||
                    target.coverPortraitId === null ||
                    !removedIds.has(target.coverPortraitId)
                ) {
                    continue
                }
                const nextPortrait = remaining.find((image) => image.characterId === targetId) ?? null
                onChangeCharacter(targetId, { coverPortraitId: nextPortrait === null ? null : nextPortrait.id })
            }
        } finally {
            setRemovingTotal(null)
        }
    }

    /** 比例与画风改动：只上报改动项，落盘与回显一律以宿主返回的真实状态为准 */
    const handleSettingsChange = (patch: ImageSettingsPatch): void => {
        void saveSettings(patch)
    }

    /**
     * 出图成功：先刷新列表，再看是否需要认领角色封面。
     * 只有顶栏选中了角色、且该角色尚无封面时才认领，已有封面不被新图顶掉，避免覆盖用户手动选定的那张。
     */
    const handleGenerated = (result: ImageGenerateResult): void => {
        // 静默刷新：不切 isLoading，占位由 isRefreshingResult 延续到新图入列，视线里只发生一次替换
        setIsRefreshingResult(true)
        void reload({ silent: true }).finally(() => {
            setIsRefreshingResult(false)
        })
        if (activeCharacterId === null) {
            return
        }
        const target = charactersById.get(activeCharacterId)
        if (target === undefined || target.coverPortraitId !== null) {
            return
        }
        onChangeCharacter(activeCharacterId, { coverPortraitId: result.image.id })
    }

    /** 取消后迟到的落盘：只静默补列表，不认领封面，也不动筛选与选中集合，避免打断用户当前状态 */
    const handleLateGenerated = (): void => {
        void reload({ silent: true })
    }

    /** 单张删除的同步入口：网格与详情面板传的都是这个，Promise 在内部收口 */
    const deleteImage = (image: PressImageItem): void => {
        void handleDelete(image)
    }

    /** 详情面板开关：关闭时清掉选中图片，图片本身由面板自身控制 */
    const handleDetailOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setSelected(null)
        }
    }

    /** 请求批量删除：只打开二次确认，真正的删除在确认后执行 */
    const requestBatchDelete = (): void => {
        setIsConfirmingBatch(true)
    }

    /** 二次确认开关：打开由标题行触发，关闭一律回到未确认态 */
    const handleConfirmingChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setIsConfirmingBatch(false)
        }
    }

    /** 确认批量删除：先收起弹窗再提交，避免删除过程中弹窗仍压在列表上 */
    const handleConfirmBatch = (): void => {
        setIsConfirmingBatch(false)
        void handleDeleteSelected()
    }

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>生图</AppTitle>
                    {isLibraryEmpty ? null : (
                        <AppAction>
                            <Badge variant="secondary">{images.length.toLocaleString('zh-CN')} 张</Badge>
                        </AppAction>
                    )}
                    <AppDescription>{setting.title}</AppDescription>
                    <AppMenu className="justify-between">
                        <ImageGenFilters
                            kind={kind}
                            kindCounts={kindCounts}
                            onKindChange={setKind}
                            characterId={characterId}
                            characters={characters}
                            onCharacterChange={setCharacterId}
                            hasActiveFilter={hasActiveFilter}
                            onClearFilters={clearFilters}
                        />
                        <ImageSelectionActions
                            isSelecting={isSelecting}
                            selectedCount={selectedPaths.size}
                            visibleCount={visibleImages.length}
                            isAllVisibleSelected={isAllVisibleSelected}
                            removingTotal={removingTotal}
                            onToggleSelecting={handleToggleSelecting}
                            onSelectAll={handleSelectAll}
                            onRequestDelete={requestBatchDelete}
                        />
                    </AppMenu>
                </AppHeader>
                <AppContent isScrollable>
                    <ImageGenGallery
                        isLoading={isLoading}
                        isPending={isGenerating || isRefreshingResult}
                        isLibraryEmpty={isLibraryEmpty}
                        filteredTotal={filtered.length}
                        visibleImages={visibleImages}
                        coverSelectedId={coverSelectedId}
                        characterNames={characterNames}
                        isSelecting={isSelecting}
                        selectedPaths={selectedPaths}
                        onToggleSelect={toggleSelectImage}
                        onDelete={deleteImage}
                        onCopy={copyImage}
                        onInsert={insertImage}
                        onSelect={setSelected}
                        onLoadMore={loadMore}
                    />
                </AppContent>
                {/* 出图输入区常驻底部：竖排撑满宽度，参数读完与否的占位差异由 composer 内部承担 */}
                <AppFooter className="flex-col items-stretch gap-0 pt-0">
                    <ImageComposer
                        isLoaded={isSettingsLoaded}
                        dirPath={dirPath}
                        characters={characters}
                        setting={setting}
                        activeCharacterId={activeCharacterId}
                        defaultRatio={settings.defaultRatio}
                        defaultStyle={settings.portraitStyle}
                        coverStyle={settings.coverStyle}
                        onSettingsChange={handleSettingsChange}
                        onGenerated={handleGenerated}
                        onLateGenerated={handleLateGenerated}
                        onGeneratingChange={setIsGenerating}
                    />
                </AppFooter>
            </AppPage>

            {/* 单图详情：点缩略图打开，按原始比例看大图，并在同一处设为作品封面 */}
            <ImageDetailDialog
                image={selected}
                dirPath={dirPath}
                coverSelectedId={coverSelectedId}
                characterNames={characterNames}
                onOpenChange={handleDetailOpenChange}
                onSetCover={setImageCover}
                onCopyImage={copyImage}
                onInsertImage={insertImage}
                onDelete={deleteImage}
            />

            <ConfirmDialog
                open={isConfirmingBatch}
                title={`删除选中的 ${String(selectedPaths.size)} 张图片？`}
                description="文件会移入系统回收站；若其中包含角色封面，该角色的封面会更新为剩余最新一张。"
                confirmLabel="删除选中"
                isDestructive
                size="sm"
                onOpenChange={handleConfirmingChange}
                onConfirm={handleConfirmBatch}
            />
        </>
    )
}
