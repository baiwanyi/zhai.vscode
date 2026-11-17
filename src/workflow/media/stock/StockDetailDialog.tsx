/**
 * 在线图库详情弹窗：大图预览、署名与可选尺寸档位，逐档插入或整体复制。
 * 复用约定：弹层取 ui/dialog，图片取 components/Image，按钮取 components/Button；
 * 尺寸档位由宿主按上游真实给出的档位下发，本组件只做展示与回传。
 * 关键约束：插入与复制一律回调页面，本组件不直接调宿主协议；
 * 已下载的图在本地只有一份，不再展示档位，统一按默认尺寸复用本地文件；
 * 弹窗高度取视口高上下各留 2rem，仅内容区滚动，图片按 contain 缩放不撑破窗口。
 */
import { Copy, TextCursorInput } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import type { StockPhotoSize, StockPhotoSizeKey } from '@shared/types/stock'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { JSX } from 'react'

/** 详情模型：搜索结果与已下载条目共用的展示口径，url 为本地签发的地址 */
export interface StockDetailPhoto {
    id: string
    url: string | null
    alt: string
    photographer: string | null
    width: number | null
    height: number | null
    /** 可选尺寸档位：已下载条目与上游未给档位时为空 */
    sizes: readonly StockPhotoSize[]
    downloaded: boolean
}

interface StockDetailDialogProps {
    /** 当前查看的图片：null 表示关闭 */
    photo: StockDetailPhoto | null
    onOpenChange: (isOpen: boolean) => void
    /** 插入：size 省略表示按默认尺寸（配置宽度） */
    onInsert: (photo: StockDetailPhoto, size?: StockPhotoSizeKey) => void
    onCopy: (id: string) => void
}

/** 像素文案：缺失或非正数时返回空串，由调用方过滤 */
function formatPixel(width: number | null, height: number | null): string {
    if (width === null || height === null || width <= 0 || height <= 0) {
        return ''
    }
    return `${String(width)}×${String(height)}`
}

export function StockDetailDialog({ photo, onOpenChange, onInsert, onCopy }: StockDetailDialogProps): JSX.Element {
    /** 副标题：署名与原始像素，缺失项直接省略 */
    const subtitle =
        photo === null
            ? ''
            : [photo.photographer ?? '未署名', formatPixel(photo.width, photo.height)].filter(Boolean).join(' · ')

    return (
        <Dialog open={photo !== null} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-2xl">
                {photo === null ? null : (
                    <>
                        <DialogHeader className="pr-8">
                            <DialogTitle className="text-lg">
                                {photo.alt.length > 0 ? photo.alt : '图片详情'}
                            </DialogTitle>
                            <DialogDescription>{subtitle}</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {photo.url === null ? null : (
                                <Image
                                    src={photo.url}
                                    alt={photo.alt}
                                    aspect="auto"
                                    size="lg"
                                    loading="eager"
                                    className="max-h-[45vh] w-full object-contain"
                                />
                            )}
                            <section className="mt-3 flex flex-col gap-1.5">
                                <h3 className="text-xs font-medium">插入尺寸</h3>
                                {photo.downloaded ? (
                                    <p className="bg-muted text-muted-foreground rounded-md p-2 text-xs">
                                        这张图已在本地库中，插入会复用本地文件
                                    </p>
                                ) : photo.sizes.length === 0 ? (
                                    <p className="bg-muted text-muted-foreground rounded-md p-2 text-xs">
                                        上游没有提供可选尺寸
                                    </p>
                                ) : (
                                    <ul className="flex flex-col gap-1">
                                        {photo.sizes.map((size) => (
                                            <li
                                                key={size.key}
                                                className="bg-muted/40 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                                            >
                                                <span className="font-medium">{size.label}</span>
                                                <span className="text-muted-foreground tabular-nums">
                                                    {formatPixel(size.width, size.height)}
                                                </span>
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className="ml-auto"
                                                    aria-label="插入到内容"
                                                    tooltip="插入到内容"
                                                    onClick={() => onInsert(photo, size.key)}
                                                >
                                                    <TextCursorInput />
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </div>
                        <DialogFooter className="flex-row items-center justify-between">
                            <Button variant="outline" onClick={() => onCopy(photo.id)}>
                                <Copy />
                                复制图片
                            </Button>
                            <Button onClick={() => onInsert(photo)}>
                                <TextCursorInput />
                                按默认尺寸插入
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
