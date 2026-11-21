/**
 * 图片选择器：发表框工具栏上的 Popover，展示 uploads 下的图片供勾选，并可从这里直接上传。
 * 复用约定：Popover 取 @components/ui/popover，清单与上传动作由调用方注入
 * （useWeiboComposerImages 持有清单与上传回执），缩略图直接用宿主签发的 url，按钮取 @webview/components/Button。
 * 关键约束：只渲染图片条目，非图片文件不进面板；已选条目置灰禁用，避免同一张图重复加入；
 * 打开面板时回调 onOpen 由调用方静默重拉清单，本组件不持有清单状态。
 */
import { cn } from 'cn'
import { Check, ImagePlus, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Spinner } from '@components/ui/spinner'
import type { UploadFileItem } from '@shared/types/upload'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface WeiboImagePickerProps {
    /** uploads 下的图片清单 */
    images: readonly UploadFileItem[]
    /** 正在读取清单 */
    isLoading: boolean
    /** 正在上传：按钮据此禁用 */
    isUploading: boolean
    /** 已选图片路径：面板据此显示勾选态并禁用重复添加 */
    selectedPaths: readonly string[]
    /** 面板打开：调用方借此重拉 uploads 清单 */
    onOpen: () => void
    /** 从磁盘选择图片上传：回执由调用方的控制器处理 */
    onPickFiles: () => void
    /** 选中一张图片 */
    onSelect: (item: UploadFileItem) => void
}

export function WeiboImagePicker({
    images,
    isLoading,
    isUploading,
    selectedPaths,
    onOpen,
    onPickFiles,
    onSelect,
}: WeiboImagePickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)

    const handleOpenChange = useCallback(
        (open: boolean): void => {
            setIsOpen(open)
            if (open) {
                onOpen()
            }
        },
        [onOpen],
    )

    const selected = new Set(selectedPaths)

    /** 面板主体：加载 / 空库 / 缩略图网格 */
    function renderBody(): JSX.Element {
        if (isLoading && images.length === 0) {
            return (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Spinner className="size-3.5" aria-hidden="true" />
                    正在读取图片...
                </div>
            )
        }
        if (images.length === 0) {
            return <PopoverDescription>uploads 里还没有图片，点下方「上传图片」从磁盘选一张。</PopoverDescription>
        }
        return (
            <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
                {images.map((item) => {
                    const isSelected = selected.has(item.path)
                    return (
                        <button
                            key={item.path}
                            type="button"
                            title={item.name}
                            aria-label={`选择图片：${item.name}`}
                            aria-pressed={isSelected}
                            disabled={isSelected}
                            className={cn(
                                'relative aspect-square overflow-hidden rounded-md border border-border bg-muted',
                                isSelected ? 'cursor-default' : 'hover:ring-2 hover:ring-ring',
                            )}
                            onClick={() => {
                                onSelect(item)
                            }}
                        >
                            {item.url === null ? null : (
                                <img src={item.url} alt={item.name} className="size-full object-cover" loading="lazy" />
                            )}
                            {isSelected ? (
                                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                                    <Check className="size-4" aria-hidden="true" />
                                </span>
                            ) : null}
                        </button>
                    )
                })}
            </div>
        )
    }

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                {/* 工具栏图标按钮：图标在上、文字在下，与表情按钮同形 */}
                <Button variant="ghost" title="添加图片" className="h-auto flex-col gap-0.5 px-2 py-1">
                    <ImagePlus className="size-4" aria-hidden="true" />
                    <span className="text-xs">图片</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80"
                onCloseAutoFocus={(event) => {
                    // 选完图片焦点要交回输入框，方便继续写正文
                    event.preventDefault()
                }}
            >
                <PopoverHeader>
                    <PopoverTitle>添加图片</PopoverTitle>
                    <PopoverDescription>勾选后显示在发布框下方，发布前可随时移除。</PopoverDescription>
                </PopoverHeader>
                {renderBody()}
                <Button size="sm" variant="outline" isLoading={isUploading} onClick={onPickFiles}>
                    <Upload className="size-3.5" aria-hidden="true" />
                    上传图片
                </Button>
            </PopoverContent>
        </Popover>
    )
}
