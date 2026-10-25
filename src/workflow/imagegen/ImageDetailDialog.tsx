/**
 * 图片详情弹窗：按原始比例查看单张大图，并就地设为作品封面、复制、插入到文章或删除。
 * 复用约定：弹层取 ui/dialog（DialogTitle / DialogDescription 提供无障碍结构），图片取 components/Image，
 * 折叠块取 ui/collapsible，无参数空态取 ui/empty；出图参数由 useImageDetail 按图片路径读取同名侧车。
 * 关键约束：image 为 null 即关闭，关闭只经 onOpenChange 上报；复制、插入、删除与设封面一律交给页面，
 * 本组件不直接调宿主协议，避免副作用散落两处；参数区只在有内容时渲染，缺失时给空态说明；
 * 弹窗高度取视口高上下各留 2rem，仅参数区滚动，图片按 contain 缩放不撑破窗口。
 */
import { ChevronRight, Copy, TextCursorInput, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@components/ui/empty'
import { Skeleton } from '@components/ui/skeleton'
import type { PressImageItem, PressImageKind } from '@shared/types/imagegen'
import { formatDateTime } from '@shared/utils/format'
import { Image } from '@webview/components/Image'
import { styleLabelOf } from './imageStyle'
import { useImageDetail } from './useImageDetail'
import type { JSX } from 'react'

/** 详情面板里的类别文案：与筛选条共用同一套中文名，避免两处口径不一致 */
const KIND_LABELS: Readonly<Record<PressImageKind, string>> = {
    portrait: '角色图',
    photo: '普通图',
    orphan: '未归类',
}

interface ImageDetailDialogProps {
    /** 当前查看的图片：null 表示关闭 */
    image: PressImageItem | null
    /** 当前作品目录：侧车参数从该作品目录读起 */
    dirPath: string
    /** 作品封面当前指向的图片 id */
    coverSelectedId: string | null
    /** 角色 id → 名称：用于副标题与图片替代文本 */
    characterNames: ReadonlyMap<string, string>
    onOpenChange: (isOpen: boolean) => void
    onSetCover: (image: PressImageItem) => void
    onCopyImage: (image: PressImageItem) => void
    onInsertImage: (image: PressImageItem) => void
    onDelete: (image: PressImageItem) => void
}

export function ImageDetailDialog({
    image,
    dirPath,
    coverSelectedId,
    characterNames,
    onOpenChange,
    onSetCover,
    onCopyImage,
    onInsertImage,
    onDelete,
}: ImageDetailDialogProps): JSX.Element {
    const path = image === null ? null : image.path
    const { detail, isLoading } = useImageDetail(dirPath, path)

    /** 参数区是否有可展示内容：侧车可能只落了部分字段，任一非空即展示 */
    const hasDetail =
        detail !== null &&
        (detail.prompt !== null || detail.ratio !== null || detail.style !== null || detail.enhancedFrom !== null)

    /** 参数行：比例与画风缺失时整行不渲染，不留下空白分隔符 */
    const detailMeta =
        detail === null
            ? ''
            : [
                  // 生图页写比例（3:4），角色卡写像素尺寸（768x1024），按值形态给对应文案
                  detail.ratio === null ? null : `${detail.ratio.includes('x') ? '尺寸' : '比例'} ${detail.ratio}`,
                  detail.style === null ? null : `画风 ${styleLabelOf(detail.style)}`,
              ]
                  .filter((part) => part !== null)
                  .join(' · ')

    /** 详情副标题：类别、所属角色与生成时间，缺失项直接省略，避免出现空分隔符 */
    const describeImage = (target: PressImageItem): string => {
        const parts = [KIND_LABELS[target.kind]]
        if (target.characterId !== null) {
            parts.push(characterNames.get(target.characterId) ?? target.characterId)
        }
        const created = formatDateTime(target.createdAt)
        if (created.length > 0) {
            parts.push(created)
        }
        return parts.join(' · ')
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

    return (
        <Dialog open={image !== null} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-2xl">
                {image === null ? null : (
                    <>
                        {/* 标题右侧让出关闭按钮的位置，长文件名不会压到 X 上 */}
                        <DialogHeader className="pr-8">
                            <DialogTitle className="text-lg">图片详情</DialogTitle>
                            <DialogDescription>{describeImage(image)}</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <Image
                                src={image.url}
                                alt={
                                    image.characterId === null
                                        ? image.id
                                        : (characterNames.get(image.characterId) ?? image.id)
                                }
                                aspect="auto"
                                size="lg"
                                loading="eager"
                                className="max-h-[50vh] w-full object-contain"
                            />
                            <p className="text-muted-foreground mt-2 break-all text-xs">{image.path}</p>
                            {isLoading ? (
                                <div className="mt-3 flex flex-col gap-1.5">
                                    <Skeleton className="h-4 w-16" />
                                    <Skeleton className="h-16 w-full" />
                                    <Skeleton className="h-3 w-24" />
                                </div>
                            ) : hasDetail ? (
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
                        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => onDelete(image)}
                            >
                                <Trash2 />
                                删除这张图片
                            </Button>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => onCopyImage(image)}>
                                    <Copy />
                                    复制图片
                                </Button>
                                <Button type="button" variant="outline" onClick={() => onInsertImage(image)}>
                                    <TextCursorInput />
                                    插入到文章
                                </Button>
                                <Button
                                    type="button"
                                    disabled={image.id === coverSelectedId}
                                    onClick={() => onSetCover(image)}
                                >
                                    {image.id === coverSelectedId ? '已是作品封面' : '设为作品封面'}
                                </Button>
                            </div>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
