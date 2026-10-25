/**
 * 生图页：以筛选条 + 图片网格管理当前作品的封面、角色图与普通图片。
 * 复用约定：列表经 useImageLibrary、参数经 useImageSettings，网格由 ImageGenGrid 渲染，
 * 详情面板取 @components/ui/sheet，复制/插入复用 pressAi/copyPortrait、pressAi/insertPortrait。
 * 关键约束：筛选在内存中完成，计数里「全部」与「作品封面」由列表推导，其余取宿主分项数；
 * 「作品封面」是筛选维度而非图片类别——由 coverSelectedId 与图片 id 比较得出；
 * 删除落盘侧进回收站，本节只刷新列表，不做乐观删除；批量删除后按剩余列表修正角色封面指针，
 * 最后只列举一次；设封面后重新列举，面板仍停在该图片上；
 * 旧目录（Cover / Portraits）仍可列举，残留时提供一次性迁移入口，只搬文件不改名；
 * 作品参数读完前不挂载 composer，避免用默认值覆盖用户已保存的比例与画风；
 * 网格按固定步长分批挂载，筛选条件变化即回到首批；全选只覆盖已渲染的图片，
 * 避免把未加载的图连带删掉；选中集合与筛选签名绑定，换筛选即失效；
 * 批量删除只作用于当前筛选结果并显示逐张进度，期间禁止重复触发；
 * 详情缺侧车时给出空态说明，有增强前原文时折叠展示。
 */
import { ChevronRight, Copy, ImageIcon, TextCursorInput, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Input } from '@components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@components/ui/sheet'
import { Skeleton } from '@components/ui/skeleton'
import type { ImageSetCoverResult, PressImageItem, PressImageKind } from '@shared/types/imagegen'
import type { PortraitCopyResult, PortraitInsertResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { formatDateTime } from '@shared/utils/format'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { Image } from '@webview/components/Image'
import { ImageComposer, type PromptSettingSnapshot } from './ImageComposer'
import { ImageGenGrid } from './ImageGenGrid'
import { styleLabelOf } from './imageStyle'
import { useImageDetail } from './useImageDetail'
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

/** 详情面板里的类别文案：与筛选条共用同一套中文名，避免两处口径不一致 */
const KIND_LABELS: Readonly<Record<PressImageKind, string>> = {
    portrait: '角色图',
    photo: '普通图',
    orphan: '未归类',
}

/** 旧目录：仍有文件残留时，筛选条下方出现一次性迁移入口 */
const LEGACY_DIR_NAMES: ReadonlyArray<string> = ['Cover', 'Portraits']

/** 空选中集合：筛选切换后的派生值复用它，避免每次渲染新建对象 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

/** 网格分批挂载的步长：一次只进一屏出头的卡片，避免上百张图同时进 DOM */
const GRID_PAGE_SIZE = 60

/**
 * 图片是否落在旧目录：path 形如 press/{作品名}/{目录}/{文件名}，
 * 目录取第三段而不是前缀——前缀比对会因作品段在前而恒为 false。
 */
function isLegacyImagePath(path: string): boolean {
    const dirName = path.split('/')[2]
    return dirName !== undefined && LEGACY_DIR_NAMES.includes(dirName)
}

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
    const { images, coverSelectedId, counts, isLoading, removeImage, removeImages, migrate, reload } =
        useImageLibrary(dirPath)
    const { settings, isLoaded: isSettingsLoaded, save: saveSettings } = useImageSettings(dirPath)
    const [kind, setKind] = useState<KindFilter>('all')
    const [characterId, setCharacterId] = useState('all')
    const [keyword, setKeyword] = useState('')
    /** 详情面板当前查看的图片：null 表示未打开 */
    const [selected, setSelected] = useState<PressImageItem | null>(null)
    /** 详情侧车：只在面板打开时读取，切换图片自动重取 */
    const detail = useImageDetail(dirPath, selected === null ? null : selected.path)
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
    /** 批量删除进度：非空表示正在删除，同时用于禁用重复触发 */
    const [removing, setRemoving] = useState<{ done: number; total: number } | null>(null)
    /** 批量删除的二次确认：与单张删除不同，一次删多张更需要拦一下 */
    const [isConfirmingBatch, setIsConfirmingBatch] = useState(false)
    const [isConfirmingMigrate, setIsConfirmingMigrate] = useState(false)

    /** 旧目录里还剩多少张：迁移搬完后归零，提示条随之消失 */
    const legacyCount = useMemo(() => images.filter((image) => isLegacyImagePath(image.path)).length, [images])

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

    /** 参数区是否有可展示内容：侧车可能只落了部分字段，任一非空即展示 */
    const hasDetail =
        detail !== null &&
        (detail.prompt !== null || detail.ratio !== null || detail.style !== null || detail.enhancedFrom !== null)

    /** 参数行：比例与画风缺失时整行不渲染，不留下空白分隔符 */
    const detailMeta =
        detail === null
            ? ''
            : [
                  detail.ratio === null ? null : `比例 ${detail.ratio}`,
                  detail.style === null ? null : `画风 ${styleLabelOf(detail.style)}`,
              ]
                  .filter((part) => part !== null)
                  .join(' · ')

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
        if (removing !== null) {
            return
        }
        // 只删当前筛选结果内的勾选：勾选可能发生在更早的筛选下，不应波及此刻不可见的图
        const targets = filtered.filter((image) => selectedPaths.has(image.path))
        if (targets.length === 0) {
            return
        }
        setRemoving({ done: 0, total: targets.length })
        try {
            const { removals, images: remaining } = await removeImages(targets, (done, total) => {
                setRemoving({ done, total })
            })
            const removed = removals.filter((item) => item.result.removed).map((item) => item.image)
            if (selected !== null && removed.some((image) => image.path === selected.path)) {
                setSelected(null)
            }
            setIsSelecting(false)
            updateSelection(EMPTY_SELECTION)
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
            setRemoving(null)
        }
    }

    /** 迁移旧目录：只搬文件不改名，搬完刷新列表，旧目录清空后提示条自然消失 */
    const handleMigrate = async (): Promise<void> => {
        const result = await migrate()
        if (result === null) {
            return
        }
        toast.success(`已迁移 ${result.moved} 张${result.skipped > 0 ? `，跳过 ${result.skipped} 张` : ''}`)
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

    /** 复制提示词：侧车原文写入系统剪贴板，webview 需在点击事件内调用 */
    const handleCopyPrompt = async (prompt: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(prompt)
            toast.success('提示词已复制')
        } catch {
            toast.error('复制失败，请手动选中文本')
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

    /** 详情副标题：类别、所属角色与生成时间，缺失项直接省略，避免出现空分隔符 */
    const describeImage = (image: PressImageItem): string => {
        const parts = [KIND_LABELS[image.kind]]
        if (image.characterId !== null) {
            parts.push(characterNames.get(image.characterId) ?? image.characterId)
        }
        const created = formatDateTime(image.createdAt)
        if (created.length > 0) {
            parts.push(created)
        }
        return parts.join(' · ')
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
                {KIND_FILTERS.map((filter) => (
                    <Button
                        key={filter.value}
                        type="button"
                        size="sm"
                        variant={kind === filter.value ? 'secondary' : 'ghost'}
                        onClick={() => setKind(filter.value)}
                    >
                        {filter.label}
                        <span className="ml-1 text-xs opacity-60 tabular-nums">{countOf(filter.value)}</span>
                    </Button>
                ))}
                <div className="ml-2 flex items-center gap-1.5 overflow-x-auto">
                    <Button
                        type="button"
                        size="sm"
                        variant={characterId === 'all' ? 'secondary' : 'ghost'}
                        onClick={() => setCharacterId('all')}
                    >
                        全部角色
                    </Button>
                    {characters.map((character) => (
                        <Button
                            key={character.id}
                            type="button"
                            size="sm"
                            variant={characterId === character.id ? 'secondary' : 'ghost'}
                            onClick={() => setCharacterId(character.id)}
                        >
                            {character.name}
                        </Button>
                    ))}
                </div>
                <Input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索角色或文件名"
                    className="ml-auto h-7 w-44"
                />
                <Button
                    type="button"
                    size="sm"
                    variant={isSelecting ? 'secondary' : 'ghost'}
                    onClick={handleToggleSelecting}
                >
                    {isSelecting ? '退出选择' : '选择'}
                </Button>
            </div>

            {legacyCount > 0 ? (
                <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5">
                    <span className="text-muted-foreground text-xs">
                        有 {legacyCount} 张图仍在旧目录 Cover / Portraits 下
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => setIsConfirmingMigrate(true)}
                    >
                        迁移到 Images
                    </Button>
                </div>
            ) : null}

            {isSelecting ? (
                <div className="flex items-center gap-1.5 border-b px-4 py-1.5">
                    <span className="text-muted-foreground text-xs tabular-nums">已选 {selectedPaths.size} 张</span>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={visibleImages.length === 0}
                        onClick={handleSelectAll}
                    >
                        {selectedPaths.size === visibleImages.length && visibleImages.length > 0
                            ? '取消全选'
                            : '全选已显示'}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive ml-auto"
                        disabled={selectedPaths.size === 0 || removing !== null}
                        onClick={() => setIsConfirmingBatch(true)}
                    >
                        <Trash2 />
                        {removing === null ? '删除选中' : `正在删除 ${removing.done} / ${removing.total}`}
                    </Button>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoading ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ImageIcon />
                            </EmptyMedia>
                            <EmptyTitle>正在读取图片</EmptyTitle>
                            <EmptyDescription>首次打开需要扫描作品目录，稍候即可</EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : filtered.length === 0 ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ImageIcon />
                            </EmptyMedia>
                            <EmptyTitle>{images.length === 0 ? '还没有图片' : '没有符合条件的图片'}</EmptyTitle>
                            <EmptyDescription>
                                {images.length === 0
                                    ? '在下方输入提示词生成第一张，或打开「作品封面」模式生成作品门面'
                                    : '换个筛选条件或清空搜索词再试'}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
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
            </div>

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
                />
            ) : (
                // 参数未读完：占位与 composer 同高，避免底部输入区闪一下再长出来
                <div className="p-2">
                    <Skeleton className="h-32 w-full rounded-2xl" />
                </div>
            )}

            {/* 详情面板：点缩略图打开，按原始比例看大图，并在同一处设为作品封面 */}
            <Sheet
                open={selected !== null}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setSelected(null)
                    }
                }}
            >
                <SheetContent side="right" className="gap-3">
                    {selected === null ? null : (
                        <>
                            <SheetHeader className="pr-10">
                                <SheetTitle>图片详情</SheetTitle>
                                <SheetDescription>{describeImage(selected)}</SheetDescription>
                            </SheetHeader>
                            <div className="min-h-0 flex-1 overflow-y-auto px-4">
                                <Image
                                    src={selected.url}
                                    alt={
                                        selected.characterId === null
                                            ? selected.id
                                            : (characterNames.get(selected.characterId) ?? selected.id)
                                    }
                                    aspect="auto"
                                    size="lg"
                                    loading="eager"
                                    className="max-h-[60vh] w-full object-contain"
                                />
                                <p className="mt-2 break-all text-xs text-muted-foreground">{selected.path}</p>
                                {detail === null ? null : hasDetail ? (
                                    <div className="mt-3 flex flex-col gap-1.5">
                                        <div className="flex items-center gap-1">
                                            <p className="text-xs font-medium">出图参数</p>
                                            {detail.prompt === null ? null : (
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    className="ml-auto"
                                                    onClick={() => {
                                                        if (detail.prompt !== null) {
                                                            void handleCopyPrompt(detail.prompt)
                                                        }
                                                    }}
                                                >
                                                    <Copy />
                                                    复制提示词
                                                </Button>
                                            )}
                                        </div>
                                        {detail.prompt === null ? null : (
                                            <p className="bg-muted/40 max-h-40 overflow-y-auto rounded-md p-2 text-xs leading-5 whitespace-pre-wrap break-all">
                                                {detail.prompt}
                                            </p>
                                        )}
                                        {detailMeta.length === 0 ? null : (
                                            <p className="text-muted-foreground text-xs">{detailMeta}</p>
                                        )}
                                        {detail.enhancedFrom === null ? null : (
                                            <Collapsible>
                                                <CollapsibleTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        size="xs"
                                                        variant="ghost"
                                                        className="group self-start px-0"
                                                    >
                                                        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                                                        增强前原文
                                                    </Button>
                                                </CollapsibleTrigger>
                                                <CollapsibleContent>
                                                    <p className="bg-muted/40 mt-1 max-h-32 overflow-y-auto rounded-md p-2 text-xs leading-5 whitespace-pre-wrap break-all">
                                                        {detail.enhancedFrom}
                                                    </p>
                                                </CollapsibleContent>
                                            </Collapsible>
                                        )}
                                    </div>
                                ) : (
                                    <Empty className="mt-3 flex-none border-0 p-3">
                                        <EmptyHeader>
                                            <EmptyTitle className="text-xs">没有出图参数</EmptyTitle>
                                            <EmptyDescription className="text-xs">
                                                这张图没有同名侧车记录，可能是旧目录里的图或手工放入的文件
                                            </EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                )}
                            </div>
                            <SheetFooter>
                                <Button
                                    type="button"
                                    disabled={selected.id === coverSelectedId}
                                    onClick={() => {
                                        void handleSetCover(selected)
                                    }}
                                >
                                    {selected.id === coverSelectedId ? '已是作品封面' : '设为作品封面'}
                                </Button>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => {
                                            void handleCopyImage(selected)
                                        }}
                                    >
                                        <Copy />
                                        复制图片
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => {
                                            void handleInsertImage(selected)
                                        }}
                                    >
                                        <TextCursorInput />
                                        插入到文章
                                    </Button>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => {
                                        void handleDelete(selected)
                                    }}
                                >
                                    <Trash2 />
                                    删除这张图片
                                </Button>
                            </SheetFooter>
                        </>
                    )}
                </SheetContent>
            </Sheet>

            <ConfirmDialog
                open={isConfirmingBatch}
                title={`删除选中的 ${selectedPaths.size} 张图片？`}
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

            <ConfirmDialog
                open={isConfirmingMigrate}
                title={`把 ${legacyCount} 张图片迁移到 Images？`}
                description="只移动文件、不改文件名：作品封面会自动指向新位置，角色封面记录的是图片 id，不受目录影响；目标目录已有同名文件时跳过并保留两份。"
                confirmLabel="开始迁移"
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setIsConfirmingMigrate(false)
                    }
                }}
                onConfirm={() => {
                    setIsConfirmingMigrate(false)
                    void handleMigrate()
                }}
            />
        </div>
    )
}
