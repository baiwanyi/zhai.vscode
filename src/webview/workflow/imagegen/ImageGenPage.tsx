/**
 * 生图页：以筛选条 + 图片网格管理当前作品的封面、角色图与普通图片。
 * 复用约定：列表经 useImageLibrary、参数经 useImageSettings，网格由 ImageGenGrid 渲染，
 * 详情面板取 @components/ui/sheet，复制/插入复用 pressAi/copyPortrait、pressAi/insertPortrait。
 * 关键约束：筛选在内存中完成，计数里「全部」与「作品封面」由列表推导，其余取宿主分项数；
 * 「作品封面」是筛选维度而非图片类别——由 coverSelectedId 与图片 id 比较得出；
 * 删除落盘侧进回收站，本节只刷新列表，不做乐观删除；批量删除后按剩余列表修正角色封面指针，
 * 最后只列举一次；设封面后重新列举，面板仍停在该图片上；
 * 旧目录（Cover / Portraits）仍可列举，残留时提供一次性迁移入口，只搬文件不改名；
 * 作品参数读完前不挂载 composer，避免用默认值覆盖用户已保存的比例与画风。
 */
import { Copy, ImageIcon, TextCursorInput, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
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
    const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set())
    /** 批量删除的二次确认：与单张删除不同，一次删多张更需要拦一下 */
    const [isConfirmingBatch, setIsConfirmingBatch] = useState(false)
    const [isConfirmingMigrate, setIsConfirmingMigrate] = useState(false)

    /** 旧目录里还剩多少张：迁移搬完后归零，提示条随之消失 */
    const legacyCount = useMemo(
        () => images.filter((image) => LEGACY_DIR_NAMES.some((dirName) => image.path.startsWith(`${dirName}/`))).length,
        [images],
    )

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
        setSelectedPaths(new Set())
    }

    const toggleSelectImage = (image: PressImageItem): void => {
        setSelectedPaths((current) => {
            const next = new Set(current)
            if (next.has(image.path)) {
                next.delete(image.path)
            } else {
                next.add(image.path)
            }
            return next
        })
    }

    /** 全选只在当前筛选结果内生效；已全选时再点即清空 */
    const handleSelectAll = (): void => {
        setSelectedPaths((current) =>
            current.size === filtered.length ? new Set() : new Set(filtered.map((image) => image.path)),
        )
    }

    /**
     * 批量删除：逐张提交后按剩余列表修正角色封面指针。
     * 关键约束：只有「被删的正是该角色当前封面」才改指针，且回退值取剩余列表里该角色最新一张，
     * 不直接采用宿主单张回执的 nextPortraitId——同批里它可能指向马上要被删掉的图。
     */
    const handleDeleteSelected = async (): Promise<void> => {
        const targets = images.filter((image) => selectedPaths.has(image.path))
        if (targets.length === 0) {
            return
        }
        const { removals, images: remaining } = await removeImages(targets)
        const removed = removals.filter((item) => item.result.removed).map((item) => item.image)
        if (selected !== null && removed.some((image) => image.path === selected.path)) {
            setSelected(null)
        }
        setIsSelecting(false)
        setSelectedPaths(new Set())
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
                        disabled={filtered.length === 0}
                        onClick={handleSelectAll}
                    >
                        {selectedPaths.size === filtered.length && filtered.length > 0 ? '取消全选' : '全选当前结果'}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive ml-auto"
                        disabled={selectedPaths.size === 0}
                        onClick={() => setIsConfirmingBatch(true)}
                    >
                        <Trash2 />
                        删除选中
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
                    <ImageGenGrid
                        images={filtered}
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
                                {detail === null || detail.prompt === null ? null : (
                                    <div className="mt-3 flex flex-col gap-1.5">
                                        <div className="flex items-center gap-1">
                                            <p className="text-xs font-medium">出图参数</p>
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
                                        </div>
                                        <p className="bg-muted/40 max-h-40 overflow-y-auto rounded-md p-2 text-xs leading-5 whitespace-pre-wrap break-all">
                                            {detail.prompt}
                                        </p>
                                        <p className="text-muted-foreground text-xs">
                                            {[
                                                detail.ratio === null ? null : `比例 ${detail.ratio}`,
                                                detail.style === null ? null : `画风 ${styleLabelOf(detail.style)}`,
                                            ]
                                                .filter((part) => part !== null)
                                                .join(' · ')}
                                        </p>
                                    </div>
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
