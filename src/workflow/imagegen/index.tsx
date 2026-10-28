/**
 * 生图页：以 app-page 骨架承载「标题与筛选区 + 图片网格 + 底部出图输入区」。
 * 复用约定：外壳取 @webview/components/AppPage（多选操作并进标题行 AppAction，作品标题与张数走 AppSummary，
 * 筛选区整行走 AppMenu，网格走 AppContent 滚动，composer 落 AppFooter），
 * 列表经 useImageLibrary、参数经 useImageSettings、筛选与分批经 useImageFilters、图片动作用 useImageActions；
 * 角色索引、多选状态、删除编排与封面指针同步分别由 useCharacterIndex / useImageSelection / useImageDeletion /
 * useCharacterCoverSync 承担；加载态与网格由 ImageGenGallery 渲染，单图详情交由 ImageDetailDialog、
 * 多选操作交由 ImageSelectionActions、类型与角色筛选交由 ImageGenFilters。
 * 关键约束：筛选只有角色与图片类别两个维度（图片体量有限，不另设关键词搜索），全部在内存中完成；
 * 「作品封面」是筛选维度而非图片类别，由 coverSelectedId 与图片 id 比较得出；
 * 删除落盘侧进回收站，本页只刷新列表；参数读完前 composer 只渲染同高骨架；
 * 出图成功只在该角色尚无封面时认领，取消后迟到的落盘只静默刷新列表；
 * 出图期间与回包后的刷新窗口内，列表首位都保留骨架占位，占位直接由新图顶替。
 */
import { useState } from 'react'
import type { ImageGenerateResult, PressImageItem } from '@shared/types/imagegen'
import { AppContent, AppFooter, AppHeader, AppMenu, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { useCharacterCoverSync } from './hooks/useCharacterCoverSync'
import { useCharacterIndex, type ImageGenCharacter } from './hooks/useCharacterIndex'
import { useImageActions } from './hooks/useImageActions'
import { useImageDeletion } from './hooks/useImageDeletion'
import { useImageFilters } from './hooks/useImageFilters'
import { useImageLibrary } from './hooks/useImageLibrary'
import { useImageSelection } from './hooks/useImageSelection'
import { useImageSettings, type ImageSettingsPatch } from './hooks/useImageSettings'
import { ImageComposer, type PromptSettingSnapshot } from './layout/ImageComposer'
import { ImageDetailDialog } from './layout/ImageDetailDialog'
import { ImageGenFilters } from './layout/ImageGenFilters'
import { ImageGenGallery } from './layout/ImageGenGallery'
import { ImageSelectionActions } from './layout/ImageSelectionActions'
import type { JSX } from 'react'

interface ImageGenPageProps {
    /** 当前作品目录：既是数据作用域，也是切换作品时的重建依据 */
    dirPath: string
    /**
     * 角色清单：用于人物筛选、卡片角标、封面指针修复与提示词里的角色段。
     * 只取人物卡里与出图相关的几项，不整体透传，避免页面耦合人物卡的全部字段。
     */
    characters: ReadonlyArray<ImageGenCharacter>
    /** 作品设定快照：「添加上下文」选中「作品设定」时展开为上下文段 */
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

    /** 角色索引：封面指针修正、卡片角标与出图认领都按 id 查，省去多处线性查找 */
    const { byId: charactersById, names: characterNames } = useCharacterIndex(characters)

    /** 详情弹窗当前查看的图片：null 表示未打开 */
    const [selected, setSelected] = useState<PressImageItem | null>(null)
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
        dirPath,
        reload,
        onDetailClose: () => {
            setSelected(null)
        },
    })

    /** 多选与删除编排：多选只在当前筛选内生效，删除后由封面同步 hook 修正角色指针 */
    const { isSelecting, selectedPaths, isAllVisibleSelected, toggleSelecting, exitSelecting, toggleImage, selectAll } =
        useImageSelection({ visibleImages, filterSignature })

    const { claimOnGenerated, syncAfterDelete, syncAfterBatchDelete } = useCharacterCoverSync({
        charactersById,
        onChangeCharacter,
    })

    const { removingTotal, isConfirmingBatch, deleteOne, requestConfirm, closeConfirm, confirmBatch } =
        useImageDeletion({
            removeImage,
            removeImages,
            filtered,
            selectedPaths,
            exitSelecting,
            detailImage: selected,
            onDetailRemoved: () => {
                setSelected(null)
            },
            syncAfterDelete,
            syncAfterBatchDelete,
        })

    /** 库里一张图都没有：空态文案与标题行张数徽标共用同一判断，避免两处各写一遍长度比较 */
    const isLibraryEmpty = images.length === 0

    /** 标题行张数：空库不展示，避免「共 0 张」与空态文案重复 */
    const photoCountText = isLibraryEmpty ? undefined : `共 ${images.length.toLocaleString('zh-CN')} 张`

    /** 比例与画风改动：只上报改动项，落盘与回显一律以宿主返回的真实状态为准 */
    const handleSettingsChange = (patch: ImageSettingsPatch): void => {
        void saveSettings(patch)
    }

    /**
     * 出图成功：先静默刷新列表，再按「该角色尚无封面」认领角色封面。
     * 认领对象取结果图自身的 characterId——composer 里的角色选择与顶栏筛选已经解耦，
     * 顶栏可能是「全部角色」或另一个人物。
     */
    const handleGenerated = (result: ImageGenerateResult): void => {
        // 静默刷新：不切 isLoading，占位由 isRefreshingResult 延续到新图入列，视线里只发生一次替换
        setIsRefreshingResult(true)
        void reload({ silent: true }).finally(() => {
            setIsRefreshingResult(false)
        })
        claimOnGenerated(result.image)
    }

    /** 取消后迟到的落盘：只静默补列表，不认领封面，也不动筛选与选中集合，避免打断用户当前状态 */
    const handleLateGenerated = (): void => {
        void reload({ silent: true })
    }

    /** 单张删除的同步入口：网格与详情面板传的都是这个，Promise 在内部收口 */
    const deleteImage = (image: PressImageItem): void => {
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

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>生图</AppTitle>
                    <AppSummary title={setting.title} path={dirPath} meta={photoCountText} />
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
                            onToggleSelecting={toggleSelecting}
                            onSelectAll={selectAll}
                            onRequestDelete={requestConfirm}
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
                        onToggleSelect={toggleImage}
                        onDelete={deleteImage}
                        onCopy={copyImage}
                        onInsert={insertImage}
                        onSelect={setSelected}
                        onLoadMore={loadMore}
                    />
                </AppContent>
                {/* 出图输入区常驻底部：竖排撑满宽度，参数读完与否的占位差异由 composer 内部承担 */}
                <AppFooter>
                    <ImageComposer
                        isLoaded={isSettingsLoaded}
                        dirPath={dirPath}
                        characters={characters}
                        setting={setting}
                        initialCharacterId={activeCharacterId}
                        defaultRatio={settings.defaultRatio}
                        defaultStyle={settings.portraitStyle}
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
                onConfirm={confirmBatch}
            />
        </>
    )
}
