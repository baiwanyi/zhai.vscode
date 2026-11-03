/**
 * 上传文件网格：按月分组展示 uploads 目录下的文件，图片给缩略图，其余给扩展名图标。
 * 复用约定：空态走 @webview/components/StateEmpty，骨架走 ui/skeleton，图片走 @webview/components/Image，
 * 卡片容器走 ui 的 ItemGroup + Item，分组头与媒体页同一吸顶样式；年月文案复用媒体页的 formatMediaMonth。
 * 关键约束：数据源是宿主返回的磁盘清单（已按年月目录倒序、目录内按文件名倒序），本组件不再排序与过滤；
 * 点击卡片只上报「复制路径」的意图，剪贴板写入与提示由页面负责。
 */
import { File as FileIcon, Upload } from 'lucide-react'
import { Item, ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { UploadFileItem } from '@shared/types/upload'
import { Image } from '@webview/components/Image'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { JSX } from 'react'
import { formatMediaMonth } from '../hooks/useImageFilters'

/** 分组头：与媒体页同一吸顶样式 */
const GROUP_HEADER_CLASS =
    'bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur'

/** 按月分组后的结构 */
interface UploadGroup {
    month: string
    label: string
    items: UploadFileItem[]
}

/** 按月分组：入参已按月份倒序，分组顺序与组内顺序都沿用 */
function groupByMonth(items: readonly UploadFileItem[]): UploadGroup[] {
    const groups: UploadGroup[] = []
    for (const item of items) {
        const last = groups[groups.length - 1]
        if (last !== undefined && last.month === item.month) {
            last.items.push(item)
            continue
        }
        groups.push({ month: item.month, label: formatMediaMonth(item.month), items: [item] })
    }
    return groups
}

/** 体积文案：不足 1KB 按字节、不足 1MB 按 KB，其余保留一位小数 */
function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${String(bytes)} B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface UploadFileGridProps {
    items: UploadFileItem[]
    isLoading: boolean
    /** 点击卡片：由页面复制相对路径并提示 */
    onCopyPath: (item: UploadFileItem) => void
}

export function UploadFileGrid({ items, isLoading, onCopyPath }: UploadFileGridProps): JSX.Element {
    if (isLoading && items.length === 0) {
        return (
            <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={`upload-skeleton-${String(index)}`} className="aspect-4/3 w-full rounded-lg" />
                ))}
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <StateEmpty
                title="还没有上传过文件"
                description="点上方区域选择文件，或把文件直接拖进来、粘贴到页面里。"
                icon={Upload}
                className="flex-1 justify-center"
            />
        )
    }

    return (
        <div className="mb-3">
            {groupByMonth(items).map((group) => (
                <section key={group.month} aria-label={group.label}>
                    <div className={GROUP_HEADER_CLASS}>
                        {group.label}
                        <span className="ml-1.5 tabular-nums">· {group.items.length} 个</span>
                    </div>
                    <ItemGroup className="grid grid-cols-2 gap-3 pt-2">
                        {group.items.map((item) => (
                            <Item
                                key={item.path}
                                variant="outline"
                                size="xs"
                                className="group relative overflow-hidden p-0 transition-[border-color,box-shadow] hover:border-ring hover:ring-3 hover:ring-ring/50"
                            >
                                <button
                                    type="button"
                                    aria-label={`复制路径：${item.name}`}
                                    title={item.path}
                                    className="block w-full cursor-pointer text-left outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                                    onClick={() => onCopyPath(item)}
                                >
                                    {item.url === null ? (
                                        <span className="flex aspect-4/3 w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
                                            <FileIcon aria-hidden className="size-6" />
                                            <span className="text-xs uppercase">{item.ext}</span>
                                        </span>
                                    ) : (
                                        <Image
                                            src={item.url}
                                            alt={item.name}
                                            aspect="4/3"
                                            className="w-full bg-muted"
                                            loading="lazy"
                                        />
                                    )}
                                    <span className="block truncate px-2 pt-1.5 text-xs">{item.name}</span>
                                    <span className="block px-2 pb-1.5 text-muted-foreground text-xs tabular-nums">
                                        {formatSize(item.byteSize)}
                                    </span>
                                </button>
                            </Item>
                        ))}
                    </ItemGroup>
                </section>
            ))}
        </div>
    )
}
