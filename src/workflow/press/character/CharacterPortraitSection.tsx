/**
 * 角色形象区块：封面三态、生成入口、画风选择与该角色的图片库，装在人物卡基础页左列。
 * 复用约定：封面回读交给 useCharacterCover、图库列举交给 useCharacterPortrait，
 * 出图的 hook 由主组件持有（切标签页会卸载本区块，挂在内部会丢掉在途回执），本组件只透传按钮状态；
 * 画风选项取 workflow/media/prompt 的 STYLE_OPTIONS，与宿主 STYLE_HINTS 同源；
 * 图库网格复用 components/Image，空态取 ui/empty，删除确认取 components/ConfirmDialog。
 * 关键约束：生成结果只改封面指针且随人物卡保存生效，删除不可撤销——被删的是当前封面时必须立即落盘回退值，
 * 只改草稿会在取消编辑后留下失效指针；图库只做「设为首选 / 删除」最小集，批量与复制等操作仍在生图页。
 */
import { Images, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@components/ui/empty'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { MediaDeleteResult } from '@shared/types/media'
import type { CharacterPortrait } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { CoverFigure } from '@webview/components/CoverFigure'
import { Image } from '@webview/components/Image'
import { STYLE_OPTIONS } from '@webview/workflow/media/prompt/imageStyle'
import { useCharacterCover } from './useCharacterCover'
import { useCharacterPortrait } from './useCharacterPortrait'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'

interface CharacterPortraitSectionProps {
    character: CharacterCard
    /** 当前作品目录：图库列举限定在该作品下 */
    dirPath: string
    /** 是否正在出图：由主组件持有，切标签页不会丢掉在途请求 */
    isGenerating: boolean
    /** 触发一次生成：姓名校验与回执处理都在主组件 */
    onGenerate: () => void
    /** 改草稿：封面指针与画风都随人物卡保存生效 */
    onChange: (patch: Partial<CharacterCard>) => void
    /** 立即落盘：删除不可撤销，封面回退不能等用户点保存 */
    onPersist: (patch: Partial<CharacterCard>) => void
}

export function CharacterPortraitSection({
    character,
    dirPath,
    isGenerating,
    onGenerate,
    onChange,
    onPersist,
}: CharacterPortraitSectionProps): JSX.Element {
    const { list } = useCharacterPortrait(dirPath)
    const { portrait, isLoading } = useCharacterCover(dirPath, character.id, character.coverPortraitId)
    const [isGalleryOpen, setIsGalleryOpen] = useState(false)
    const [gallery, setGallery] = useState<readonly CharacterPortrait[]>([])
    const [isGalleryLoading, setIsGalleryLoading] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<CharacterPortrait | null>(null)

    /** 图库列举：打开浮层与删除后各调一次，扫描结果以宿主索引为准 */
    const refreshGallery = useCallback(async (): Promise<void> => {
        setIsGalleryLoading(true)
        setGallery(await list(character.id))
        setIsGalleryLoading(false)
    }, [character.id, list])

    const handleGalleryOpenChange = (isOpen: boolean): void => {
        setIsGalleryOpen(isOpen)
        if (isOpen) {
            void refreshGallery()
        }
    }

    /** 画风随人物卡保存，切换后只影响后续生成，不回溯已有图片 */
    const handleStyleChange = (value: string): void => {
        const next = STYLE_OPTIONS.find((option) => option.value === value)
        if (next !== undefined) {
            onChange({ portraitStyle: next.value })
        }
    }

    const handlePickCover = (item: CharacterPortrait): void => {
        onChange({ coverPortraitId: item.id })
        toast.success('已设为首选图，保存人物卡后生效')
    }

    /** 删除图片：封面被删时必须当场把回退指针写进人物卡，否则文档会指向一张不存在的图 */
    const runDelete = async (target: CharacterPortrait): Promise<void> => {
        try {
            const result = await request<MediaDeleteResult>('media/delete', { id: target.id })
            if (!result.removed) {
                toast.error('图片删除失败，请稍后重试')
                return
            }
            if (character.coverPortraitId === target.id) {
                onPersist({ coverPortraitId: result.characterCoverFallbacks[character.id] ?? null })
            }
            toast.success('图片已删除')
            await refreshGallery()
        } catch (cause) {
            toastError(cause)
        }
    }

    const handleConfirmDelete = (): void => {
        const target = pendingDelete
        setPendingDelete(null)
        if (target !== null) {
            void runDelete(target)
        }
    }

    return (
        <>
            <div className="flex flex-col gap-2">
                <CoverFigure
                    src={portrait?.url ?? null}
                    isLoading={isLoading}
                    alt={`${character.name} 的角色形象`}
                    emptyTitle="还没有角色形象"
                    emptyDescription="点下方按钮按人物卡属性生成，也可以去生图页统一生成"
                />
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        isLoading={isGenerating}
                        onClick={() => {
                            // 出图期间图库不刷新会与封面不一致：先收起，下次打开按新索引重读
                            setIsGalleryOpen(false)
                            onGenerate()
                        }}
                    >
                        <Sparkles />
                        {character.coverPortraitId === null ? '生成角色形象' : '重新生成'}
                    </Button>
                    <Popover open={isGalleryOpen} onOpenChange={handleGalleryOpenChange}>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" disabled={isGenerating}>
                                <Images />
                                图库
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80">
                            <PopoverHeader>
                                <PopoverTitle>角色形象</PopoverTitle>
                            </PopoverHeader>
                            {isGalleryLoading ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="aspect-3/4 rounded-md bg-muted/40" />
                                    <div className="aspect-3/4 rounded-md bg-muted/40" />
                                </div>
                            ) : gallery.length === 0 ? (
                                <Empty className="border py-3">
                                    <EmptyHeader>
                                        <EmptyTitle>还没有图片</EmptyTitle>
                                        <EmptyDescription>生成一次后，这里保留每一版可回退</EmptyDescription>
                                    </EmptyHeader>
                                </Empty>
                            ) : (
                                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-x-hidden overflow-y-auto">
                                    {gallery.map((item, index) => {
                                        const version = gallery.length - index
                                        const isCover = item.id === character.coverPortraitId
                                        return (
                                            <div key={item.id} className="flex flex-col gap-1">
                                                <div
                                                    className={
                                                        isCover
                                                            ? 'overflow-hidden rounded-md border border-primary ring-2 ring-primary/30'
                                                            : 'overflow-hidden rounded-md border'
                                                    }
                                                >
                                                    <Image
                                                        src={item.url}
                                                        alt={`${character.name} 第 ${String(version)} 版`}
                                                        aspect="3/4"
                                                        size="none"
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 px-1 text-xs"
                                                        disabled={isCover}
                                                        onClick={() => handlePickCover(item)}
                                                    >
                                                        {isCover ? '当前首选' : '设为首选'}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        aria-label={`删除第 ${String(version)} 版`}
                                                        onClick={() => setPendingDelete(item)}
                                                    >
                                                        <Trash2 />
                                                    </Button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </PopoverContent>
                    </Popover>
                </div>
                <Select value={character.portraitStyle} onValueChange={handleStyleChange}>
                    <SelectTrigger className="h-8 w-full" aria-label="角色形象画风">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {STYLE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <ConfirmDialog
                open={pendingDelete !== null}
                title="删除这张角色形象？"
                description="删除后不可恢复。若它是当前首选，人物卡会自动回退到剩余最新的一张。"
                confirmLabel="删除"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingDelete(null)
                    }
                }}
                onConfirm={handleConfirmDelete}
            />
        </>
    )
}
