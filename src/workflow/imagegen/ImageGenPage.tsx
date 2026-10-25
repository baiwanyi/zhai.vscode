/**
 * 生图页：以 app-page 骨架承载「标题与筛选区 + 图片网格 + 底部出图输入区」。
 * 复用约定：外壳取 @webview/components/AppPage（类型筛选、角色选择与搜索各占一行 AppMenu，
 * 网格走 AppContent 滚动，composer 落 AppFooter），列表经 useImageLibrary、参数经 useImageSettings，
 * 网格由 ImageGenGrid 渲染，空态取 components/StateEmpty，单图详情交由 ImageDetailDialog，
 * 复制/插入复用 pressAi/copyPortrait、pressAi/insertPortrait。
 * 关键约束：筛选在内存中完成，计数里「全部」与「作品封面」由列表推导，其余取宿主分项数；
 * 「作品封面」是筛选维度而非图片类别，由 coverSelectedId 与图片 id 比较得出；
 * 删除落盘侧进回收站，本节只刷新列表，批量删除后按剩余列表修正角色封面指针；
 * 参数读完前不挂载 composer；网格分批挂载且全选只覆盖已渲染图片；选中集合与筛选签名绑定。
 */
import { ImageIcon, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Skeleton } from '@components/ui/skeleton'
import type { ImageSetCoverResult, PressImageItem, PressImageKind } from '@shared/types/imagegen'
import type { PortraitCopyResult, PortraitInsertResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
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
import { StateEmpty } from '@webview/components/StateEmpty'
import { ImageComposer, type PromptSettingSnapshot } from './ImageComposer'
import { ImageDetailDialog } from './ImageDetailDialog'
import { ImageGenGrid } from './ImageGenGrid'
import { useImageLibrary } from './useImageLibrary'
import { useImageSettings } from './useImageSettings'
import type { JSX } from 'react'

/** 类型筛选：封面是「当前选中」维度，与图片自身的类别并列展示 */
type KindFilter = 'all' | 'cover' | PressImageKind

const KIND_FILTERS: ReadonlyArray<{ value: KindFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'cover', label: '作品封面' },
    { value: 'portrait', label: '角色图' },
    { value: 'photo', label: '普通图' },
    { value: 'orphan', label: '未归类' },
]

/** 空选中集合：筛选切换后的派生值复用它，避免每次渲染新建对象 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

/** 网格分批挂载的步长：一次只进一屏出头的卡片，避免上百张图同时进 DOM */
const GRID_PAGE_SIZE = 60

interface ImageGenPageProps {
    /** 当前作品目录：既是数据作用域，也是切换作品时的重建依据 */
    dirPath: string
    /**
     * 角色清单：用于人物筛选、卡片角标、封面指针修复与提示词里的角色段。
     * 只取人物卡里与出图相关的几项，不整体透传，避免页面耦合人物卡的全部字段。
     */
    characters: ReadonlyArray<{
        id: string
        name: string
        coverPortraitId: string | null
        appearance?: string
        identity?: string
        gender?: 'male' | 'female'
        age?: string
    }>
    /** 作品设定快照：命令动作选中「作品设定」时展开进提示词 */
    setting: PromptSettingSnapshot
    /** 写回人物卡封面指针：删除与生成后同步，保证角色卡页与本页一致 */
    onChangeCharacter: (characterId: string, patch: { coverPortraitId: string | null }) => void
}

export function ImageGenPage({ dirPath, characters, setting, onChangeCharacter }: ImageGenPageProps): JSX.Element {
    const { images, coverSelectedId, counts, isLoading, removeImage, removeImages, reload } = useImageLibrary(dirPath)
    const { settings, isLoaded: isSettingsLoaded, save: saveSettings } = useImageSettings(dirPath)
    const [kind, setKind] = useState<KindFilter>('all')
    const [characterId, setCharacterId] = useState('all')
    const [keyword, setKeyword] = useState('')
    /** 详情弹窗当前查看的图片：null 表示未打开 */
    const [selected, setSelected] = useState<PressImageItem | null>(null)
    /** 多选模式：点击卡片切换选中，不打开详情 */
    const [isSelecting, setIsSelecting] = useState(false)
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

    const characterNames = useMemo(
        () => new Map(characters.map((character) => [character.id, character.name])),
        [characters],
    )

    const filtered = useMemo(() => {
        const text = keyword.trim().toLowerCase()
        return images.filter((image) => {
            if (characterId !== 'all' && image.characterId !== characterId) {
                return false
            }
            if (kind === 'cover' && image.id !== coverSelectedId) {
                return false
            }
            if (kind !== 'all' && kind !== 'cover' && image.kind !== kind) {
                return false
            }
            if (text.length === 0) {
                return true
            }
            const name = image.characterId === null ? '' : (characterNames.get(image.characterId) ?? '')
            return name.toLowerCase().includes(text) || image.id.toLowerCase().includes(text)
        })
    }, [images, kind, characterId, keyword, coverSelectedId, characterNames])

    /**
     * 分批渲染：用筛选签名比对而不是在每处 onChange 里重置，筛选一变即自然回到首批。
     * 已显示数量随签名保存，切回同一筛选时不必重新点击「加载更多」之外的额外状态。
     */
    const [paging, setPaging] = useState({ signature: '', count: GRID_PAGE_SIZE })
    const filterSignature = `${kind}|${characterId}|${keyword.trim().toLowerCase()}`
    const visibleCount = paging.signature === filterSignature ? paging.count : GRID_PAGE_SIZE
    const visibleImages = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

    /** 当前生效的选中集合：签名与当前筛选不一致即视为空，避免残留上一组筛选的勾选 */
    const selectedPaths = selection.signature === filterSignature ? selection.paths : EMPTY_SELECTION

    /** 写入选中集合时一并记下当前筛选签名，供上面的派生判断使用 */
    const updateSelection = (next: ReadonlySet<string>): void => {
        setSelection({ signature: filterSignature, paths: next })
    }

    /** 追加一批：记下当前筛选签名，筛选未变时在累计数量上继续加 */
    const handleLoadMore = (): void => {
        setPaging({ signature: filterSignature, count: visibleCount + GRID_PAGE_SIZE })
    }

    /** 筛选条计数：全部与作品封面由列表推导，其余取宿主返回的分项数 */
    const countOf = (filter: KindFilter): number => {
        if (filter === 'all') {
            return images.length
        }
        if (filter === 'cover') {
            return coverSelectedId === null ? 0 : 1
        }
        return counts[filter]
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
        const target = characters.find((character) => character.id === result.characterId)
        if (target === undefined || target.coverPortraitId !== image.id) {
            return
        }
        onChangeCharacter(result.characterId, { coverPortraitId: result.nextPortraitId })
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

    /** 是否存在生效中的筛选：决定是否显示「清空筛选」 */
    const hasActiveFilter = kind !== 'all' || characterId !== 'all' || keyword.trim().length > 0

    /** 一键回到全部结果：三个筛选维度一起复位，避免逐个点回 */
    const handleClearFilters = (): void => {
        setKind('all')
        setCharacterId('all')
        setKeyword('')
    }

    /** 全选只覆盖已渲染的图片：未加载的图不在视野里，不该被批量删除带走 */
    const handleSelectAll = (): void => {
        updateSelection(
            selectedPaths.size === visibleImages.length
                ? EMPTY_SELECTION
                : new Set(visibleImages.map((image) => image.path)),
        )
    }

    /**
     * 批量删除：逐张提交后按剩余列表修正角色封面指针。
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
            if (selected !== null && removed.some((image) => image.path === selected.path)) {
                setSelected(null)
            }
            // 请求级失败（removals 为空）时保留多选与勾选，用户可直接重试
            if (removals.length > 0) {
                setIsSelecting(false)
                updateSelection(EMPTY_SELECTION)
            }
            const characterIds = new Set(
                removed.flatMap((image) => (image.characterId === null ? [] : [image.characterId])),
            )
            for (const targetId of characterIds) {
                const target = characters.find((character) => character.id === targetId)
                if (target === undefined || !removed.some((image) => image.id === target.coverPortraitId)) {
                    continue
                }
                const nextPortrait = remaining.find((image) => image.characterId === targetId) ?? null
                onChangeCharacter(targetId, { coverPortraitId: nextPortrait === null ? null : nextPortrait.id })
            }
        } finally {
            setRemovingTotal(null)
        }
    }

    /** 设为作品封面：任意图片都可以，宿主只校验归属与文件存在 */
    const handleSetCover = async (image: PressImageItem): Promise<void> => {
        try {
            await request<ImageSetCoverResult>('pressAi/setImageCover', { dirPath, path: image.path })
            await reload()
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 复制到系统剪贴板：webview 内写图片受 CSP 与权限限制，交由宿主按平台写入 */
    const handleCopyImage = async (image: PressImageItem): Promise<void> => {
        try {
            const result = await request<PortraitCopyResult>('pressAi/copyPortrait', { path: image.path })
            if (result.copied) {
                toast.success('图片已复制到剪贴板')
                return
            }
            toast.error(
                result.reason === 'unsupported' ? '当前系统不支持复制图片，可改用文件管理器保存' : '复制失败，请重试',
            )
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 插入到 Markdown 光标处：无活动光标时按要求静默忽略，其余失败原因给出提示 */
    const handleInsertImage = async (image: PressImageItem): Promise<void> => {
        try {
            const result = await request<PortraitInsertResult>('pressAi/insertPortrait', { path: image.path })
            if (result.inserted) {
                setSelected(null)
                toast.success('已插入到当前文档光标处')
                return
            }
            const reason = result.reason
            if (reason === undefined || reason === 'no-editor') {
                setSelected(null)
                return
            }
            if (reason === 'not-markdown') {
                toast.error('仅在 Markdown 文件中支持插入')
                return
            }
            toast.error(reason === 'unsaved' ? '请先保存当前文档再插入' : '插入失败，请重试')
        } catch (cause) {
            toastError(cause)
        }
    }

    /** 标题区统计：张数与封面状态一句说清，不占用独立区块 */
    const summary =
        images.length === 0
            ? '用下方提示词生成第一张，或切到「作品封面」模式生成作品门面'
            : `共 ${String(images.length)} 张 · 点缩略图查看详情与出图参数`

    /** 全选按钮文案：已选与已渲染张数相等时改为取消 */
    const isAllVisibleSelected = visibleImages.length > 0 && selectedPaths.size === visibleImages.length

    return (
        <>
            <AppPage>
                <AppHeader>
                    {/* 眉标：作品名与说明同用弱化小字，避免与页面标题争夺主视觉 */}
                    {setting.title === undefined || setting.title.length === 0 ? null : (
                        <AppDescription>{setting.title}</AppDescription>
                    )}
                    <AppTitle>生图</AppTitle>
                    <AppAction>
                        <Button
                            type="button"
                            size="sm"
                            variant={isSelecting ? 'secondary' : 'ghost'}
                            onClick={handleToggleSelecting}
                        >
                            {isSelecting ? '退出选择' : '选择'}
                        </Button>
                    </AppAction>
                    <AppDescription>{summary}</AppDescription>
                    <AppMenu>
                        {KIND_FILTERS.map((filter) => (
                            <Button
                                key={filter.value}
                                type="button"
                                size="sm"
                                variant={kind === filter.value ? 'secondary' : 'ghost'}
                                onClick={() => setKind(filter.value)}
                            >
                                {filter.label}
                                <span className="ml-1 text-xs tabular-nums opacity-60">{countOf(filter.value)}</span>
                            </Button>
                        ))}
                    </AppMenu>
                    <AppMenu>
                        <Select
                            value={characterId}
                            onValueChange={(value) => {
                                setCharacterId(value)
                            }}
                        >
                            <SelectTrigger className="h-8 w-28 shrink-0" aria-label="按角色筛选">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="all">全部角色</SelectItem>
                                    {characters.map((character) => (
                                        <SelectItem key={character.id} value={character.id}>
                                            {character.name}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <InputGroup className="min-w-0 flex-1">
                            <InputGroupAddon>
                                <Search />
                            </InputGroupAddon>
                            <InputGroupInput
                                value={keyword}
                                aria-label="搜索图片"
                                placeholder="搜索角色或文件名"
                                onChange={(event) => setKeyword(event.target.value)}
                            />
                        </InputGroup>
                        {hasActiveFilter ? (
                            <Button type="button" size="sm" variant="ghost" onClick={handleClearFilters}>
                                清空筛选
                            </Button>
                        ) : null}
                    </AppMenu>
                    {/* 多选操作行只在选择模式出现：常态不占位，避免标题区长期多一行空气 */}
                    {isSelecting ? (
                        <AppMenu>
                            <span className="text-muted-foreground text-xs tabular-nums">
                                已选 {selectedPaths.size} 张
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={visibleImages.length === 0}
                                onClick={handleSelectAll}
                            >
                                {isAllVisibleSelected ? '取消全选' : '全选已显示'}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive ml-auto"
                                disabled={selectedPaths.size === 0 || removingTotal !== null}
                                onClick={() => setIsConfirmingBatch(true)}
                            >
                                <Trash2 />
                                {removingTotal === null ? '删除选中' : `正在删除 ${String(removingTotal)} 张`}
                            </Button>
                        </AppMenu>
                    ) : null}
                </AppHeader>
                <AppContent isScrollable>
                    {isLoading ? (
                        <StateEmpty
                            title="正在读取图片"
                            isLoading
                            loadingLabel="正在读取图片"
                            className="flex-1 justify-center"
                        />
                    ) : filtered.length === 0 ? (
                        <StateEmpty
                            title={images.length === 0 ? '还没有图片' : '没有符合条件的图片'}
                            description={
                                images.length === 0
                                    ? '在下方输入提示词生成第一张，或打开「作品封面」模式生成作品门面'
                                    : '换个筛选条件或清空搜索词再试'
                            }
                            icon={ImageIcon}
                            className="flex-1 justify-center"
                        />
                    ) : (
                        <>
                            <ImageGenGrid
                                images={visibleImages}
                                coverSelectedId={coverSelectedId}
                                characterNames={characterNames}
                                isSelecting={isSelecting}
                                selectedPaths={selectedPaths}
                                onToggleSelect={toggleSelectImage}
                                onDelete={(image) => void handleDelete(image)}
                                onCopy={(image) => void handleCopyImage(image)}
                                onInsert={(image) => void handleInsertImage(image)}
                                onSelect={setSelected}
                            />
                            {visibleImages.length < filtered.length ? (
                                <div className="flex justify-center px-4 pb-4">
                                    <Button type="button" size="sm" variant="outline" onClick={handleLoadMore}>
                                        加载更多（{visibleImages.length} / {filtered.length}）
                                    </Button>
                                </div>
                            ) : null}
                        </>
                    )}
                </AppContent>
                {/* 出图输入区常驻底部：竖排撑满宽度，自身的内边距与骨架留白一致，不叠加横向间隙 */}
                <AppFooter className="flex-col items-stretch gap-0 pt-0">
                    {isSettingsLoaded ? (
                        <ImageComposer
                            dirPath={dirPath}
                            characters={characters}
                            setting={setting}
                            activeCharacterId={characterId === 'all' ? null : characterId}
                            defaultRatio={settings.defaultRatio}
                            defaultStyle={settings.portraitStyle}
                            coverStyle={settings.coverStyle}
                            onSettingsChange={(patch) => {
                                void saveSettings(patch)
                            }}
                            onGenerated={(result) => {
                                void reload()
                                if (characterId === 'all') {
                                    return
                                }
                                // 该角色还没有封面时才自动认领，已有封面不被新图顶掉
                                const target = characters.find((character) => character.id === characterId)
                                if (target === undefined || target.coverPortraitId !== null) {
                                    return
                                }
                                onChangeCharacter(characterId, { coverPortraitId: result.image.id })
                            }}
                            // 取消后迟到的落盘：只补列表，不认领封面，也不打断用户当前的筛选与选择
                            onLateGenerated={() => {
                                void reload({ silent: true })
                            }}
                        />
                    ) : (
                        // 参数未读完：占位与 composer 同高，避免底部输入区闪一下再长出来
                        <div className="p-2">
                            <Skeleton className="h-32 w-full rounded-2xl" />
                        </div>
                    )}
                </AppFooter>
            </AppPage>

            {/* 单图详情：点缩略图打开，按原始比例看大图，并在同一处设为作品封面 */}
            <ImageDetailDialog
                image={selected}
                dirPath={dirPath}
                coverSelectedId={coverSelectedId}
                characterNames={characterNames}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setSelected(null)
                    }
                }}
                onSetCover={(image) => {
                    void handleSetCover(image)
                }}
                onCopyImage={(image) => {
                    void handleCopyImage(image)
                }}
                onInsertImage={(image) => {
                    void handleInsertImage(image)
                }}
                onDelete={(image) => {
                    void handleDelete(image)
                }}
            />

            <ConfirmDialog
                open={isConfirmingBatch}
                title={`删除选中的 ${String(selectedPaths.size)} 张图片？`}
                description="文件会移入系统回收站；若其中包含角色封面，该角色的封面会更新为剩余最新一张。"
                confirmLabel="删除选中"
                isDestructive
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setIsConfirmingBatch(false)
                    }
                }}
                onConfirm={() => {
                    setIsConfirmingBatch(false)
                    void handleDeleteSelected()
                }}
            />
        </>
    )
}
