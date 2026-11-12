/**
 * 作品封面区块：封面三态、生成入口与该作品的封面候选图库，装在设定页基本信息左列。
 * 复用约定：封面回读交给 useSettingCover（带外部刷新信号），图库列举走 pressAi/listCover，
 * 设封面走 media/setCover、删除走 media/delete，与生图页共用同一份封面指针与媒体索引；
 * 图库网格复用 components/Image，空态取 ui/empty，删除确认取 components/ConfirmDialog。
 * 关键约束：生成的在途状态与回执由页面持有（切分组会卸载本区块），本组件只透传按钮状态；
 * 封面指针在宿主侧，设封面与删除后一律重读而不能只改本地状态；
 * 删除的回退由宿主在删除时写回指针，这里不做二次写入，避免与媒体页口径分叉。
 */
import { Images, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@components/ui/empty'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@components/ui/popover'
import type { MediaDeleteResult, MediaSetCoverResult } from '@shared/types/media'
import type { CoverListResult, PressCover } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { CoverFigure } from '@webview/components/CoverFigure'
import { Image } from '@webview/components/Image'
import { useSettingCover } from './useSettingCover'
import type { ProjectSetting } from '../types'
import type { JSX } from 'react'

interface SettingCoverSectionProps {
    setting: ProjectSetting
    /** 当前作品目录：封面回读、出图归属与设封面都限定在该作品下 */
    dirPath: string
    /** 是否正在出图：由页面持有，切分组不会丢掉在途请求 */
    isGenerating: boolean
    /** 生成完成信号：页面在生成成功后递增，触发封面重读 */
    refreshKey: number
    /** 触发一次封面生成：提示词拼装与设封面都在页面注入的 hook 内 */
    onGenerate: () => void
}

export function SettingCoverSection({
    setting,
    dirPath,
    isGenerating,
    refreshKey,
    onGenerate,
}: SettingCoverSectionProps): JSX.Element {
    const { cover, isLoading, reload } = useSettingCover(dirPath, refreshKey)
    const [isGalleryOpen, setIsGalleryOpen] = useState(false)
    const [covers, setCovers] = useState<readonly PressCover[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [total, setTotal] = useState(0)
    const [isGalleryLoading, setIsGalleryLoading] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<PressCover | null>(null)

    /** 图库列举：宿主按时间降序截断，total 用于提示「只显示最新一批」 */
    const refreshGallery = useCallback(async (): Promise<void> => {
        setIsGalleryLoading(true)
        try {
            const result = await request<CoverListResult>('pressAi/listCover', { dirPath })
            setCovers(result.covers)
            setSelectedId(result.selectedId)
            setTotal(result.total)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsGalleryLoading(false)
        }
    }, [dirPath])

    // 打开浮层与生成完成都重读候选：生成发生在页面层，本组件只能靠 refreshKey 感知
    useEffect(() => {
        if (!isGalleryOpen) {
            return
        }
        void refreshGallery()
    }, [isGalleryOpen, refreshGallery, refreshKey])

    /** 设为首选：封面指针在宿主，写完必须回读，不能只改本地选中态 */
    const handlePickCover = (item: PressCover): void => {
        const run = async (): Promise<void> => {
            try {
                await request<MediaSetCoverResult>('media/setCover', { id: item.id, pressPath: dirPath })
                reload()
                await refreshGallery()
                toast.success('已设为作品封面')
            } catch (cause) {
                toastError(cause)
            }
        }
        void run()
    }

    /** 删除封面候选：被删的是当前封面时，宿主会在删除时把指针回退到剩余最新一张 */
    const runDelete = async (target: PressCover): Promise<void> => {
        try {
            const result = await request<MediaDeleteResult>('media/delete', { id: target.id })
            if (!result.removed) {
                toast.error('图片删除失败，请稍后重试')
                return
            }
            reload()
            await refreshGallery()
            toast.success('图片已删除')
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

    /** 当前生效的封面：未设指针时与 CoverFigure 同口径，视最新一张为封面 */
    const activeId = selectedId ?? covers[0]?.id ?? cover?.id ?? null

    return (
        <>
            <div className="flex flex-col gap-2">
                <CoverFigure
                    src={cover?.url ?? null}
                    isLoading={isLoading}
                    alt={`《${setting.title.length > 0 ? setting.title : '未命名'}》的封面`}
                    emptyTitle="还没有作品封面"
                    emptyDescription="点下方按钮按作品设定生成，也可以去生图页统一生成"
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
                        {cover === null ? '生成封面' : '重新生成'}
                    </Button>
                    <Popover open={isGalleryOpen} onOpenChange={setIsGalleryOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" disabled={isGenerating}>
                                <Images />
                                图库
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80">
                            <PopoverHeader>
                                <PopoverTitle>封面候选</PopoverTitle>
                            </PopoverHeader>
                            {isGalleryLoading ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="aspect-3/4 rounded-md bg-muted/40" />
                                    <div className="aspect-3/4 rounded-md bg-muted/40" />
                                </div>
                            ) : covers.length === 0 ? (
                                <Empty className="border py-3">
                                    <EmptyHeader>
                                        <EmptyTitle>还没有封面</EmptyTitle>
                                        <EmptyDescription>生成一次后，这里保留每一版可回退</EmptyDescription>
                                    </EmptyHeader>
                                </Empty>
                            ) : (
                                <>
                                    <div className="grid max-h-64 grid-cols-2 gap-2 overflow-x-hidden overflow-y-auto">
                                        {covers.map((item, index) => {
                                            const version = covers.length - index
                                            const isCover = item.id === activeId
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
                                                            alt={`《${setting.title.length > 0 ? setting.title : '未命名'}》封面候选 ${String(version)}`}
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
                                                            {isCover ? '当前封面' : '设为首选'}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            aria-label={`删除封面候选 ${String(version)}`}
                                                            onClick={() => setPendingDelete(item)}
                                                        >
                                                            <Trash2 />
                                                        </Button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                    {total > covers.length ? (
                                        <p className="text-muted-foreground text-xs">
                                            仅显示最新 {String(covers.length)} 张，共 {String(total)}{' '}
                                            张，其余请去生图页管理
                                        </p>
                                    ) : null}
                                </>
                            )}
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
            <ConfirmDialog
                open={pendingDelete !== null}
                title="删除这张封面候选？"
                description="删除后不可恢复。若它是当前封面，会自动回退到剩余最新的一张。"
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
