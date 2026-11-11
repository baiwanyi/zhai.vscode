/**
 * 上传页：页头「上传」按钮展开选择文件区，拖拽与粘贴常驻，并展示 uploads 目录下已上传的文件。
 * 入口在侧栏导航，作品、笔记、公众号与普通文档共用同一页——上传与内容归属无关。
 * 复用约定：外壳取 @webview/components/AppPage，清单与上传动作由 useUploader 统一持有；
 * 列表走统一图片列表 ImageList，条目经 imageListAdapters 映射、按月分组取 hooks/mediaMonth，
 * 复制路径走 @shared/utils/clipboard 并按正文引用口径补 @zhai/ 前缀。
 * 关键约束：文件落 {存储根}/uploads/{YYYYMM}/，文件名由宿主生成，页面不提供重命名；
 * 卡片单击插入到当前文档（图片用图片语法、其余用链接），不展示文件名；
 * 左下角角标给像素与体积——像素由图片解码后回报并缓存，非图片文件只给体积；
 * 右下角悬停动作是复制路径与删除，删除经二次确认后由宿主移入回收站；
 * 上传区默认收起、由页头按钮切换，拖拽与粘贴不受影响；本页与媒体页不共用数据源；
 * 上传成功后只静默重拉清单，不做乐观插入。
 */
import { Copy, FolderOpen, Trash2, Upload } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { UploadFileItem } from '@shared/types/upload'
import { copyToClipboard } from '@shared/utils/clipboard'
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'
import { AppAction, AppContent, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { groupByMonth } from './hooks/mediaMonth'
import { useUploader } from './hooks/useUploader'
import { ImageList } from './layout/imageList/ImageList'
import { toImageListGroups, toUploadFileItem } from './layout/imageList/imageListAdapters'
import type { ImageListAction, ImageListStates } from './layout/imageList/imageListModel'
import type { JSX } from 'react'

/** 上传列表状态位：首屏给骨架，空库给引导文案 */
const LIST_STATES: ImageListStates = {
    loadingMode: 'skeleton',
    empty: {
        title: '还没有上传过文件',
        description: '点页头「上传」选择文件，或把文件直接拖进来、粘贴到页面里。',
        icon: Upload,
    },
}

/** 图片原始像素：图片解码后回报，用于左下角角标 */
interface PixelSize {
    width: number
    height: number
}

export function WorkflowUpload(): JSX.Element {
    const {
        items,
        isLoading,
        isUploading,
        isRevealing,
        isRemoving,
        isDragging,
        dragHandlers,
        pickFiles,
        insert,
        remove,
        reveal,
    } = useUploader()

    /** 上传区显隐：默认收起，由页头「上传」按钮切换，拖拽与粘贴不受影响 */
    const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(false)
    /** 已测量到的像素：键为相对路径，滚动后回看不必重新解码 */
    const [pixels, setPixels] = useState<ReadonlyMap<string, PixelSize>>(() => new Map())
    /** 待确认删除的文件：null 表示未打开确认框 */
    const [pendingRemove, setPendingRemove] = useState<UploadFileItem | null>(null)

    /** 像素回报：同值不更新，避免解码回调把列表反复打回渲染 */
    const handleMeasured = useCallback((path: string, width: number, height: number): void => {
        setPixels((current) => {
            const existing = current.get(path)
            if (existing !== undefined && existing.width === width && existing.height === height) {
                return current
            }
            const next = new Map(current)
            next.set(path, { width, height })
            return next
        })
    }, [])

    /** 按月分组：入参已按目录倒序，分组与条目映射都走纯函数 */
    const groups = useMemo(
        () =>
            toImageListGroups(groupByMonth(items), (item) => ({
                ...toUploadFileItem(item, {}, pixels.get(item.path)),
                onMeasured: (width: number, height: number): void => {
                    handleMeasured(item.path, width, height)
                },
            })),
        [handleMeasured, items, pixels],
    )

    /** 复制路径：按正文引用口径补 @zhai/ 前缀，粘回文档即可被识别 */
    function handleCopyPath(item: UploadFileItem): void {
        void (async (): Promise<void> => {
            const isSuccess = await copyToClipboard(`${ZHAI_PATH_PREFIX}${item.path}`)
            if (isSuccess) {
                toast.success('已复制文件路径')
                return
            }
            toast.error('复制失败，请手动复制')
        })()
    }

    /** 右下角悬停动作：复制路径与删除，删除先经二次确认 */
    const uploadActions: ImageListAction<UploadFileItem>[] = [
        {
            key: 'copy',
            label: '复制文件路径',
            icon: Copy,
            onTrigger: (item) => handleCopyPath(item.source),
        },
        {
            key: 'delete',
            label: '删除文件',
            icon: Trash2,
            variant: 'destructive',
            onTrigger: (item) => setPendingRemove(item.source),
        },
    ]

    return (
        <>
            <AppPage className="relative" {...dragHandlers}>
                {isDragging ? (
                    <div className="bg-background/80 pointer-events-none absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm">
                        <p className="border-primary rounded-xl border-2 border-dashed px-6 py-4 text-sm font-medium">
                            松开即可上传文件
                        </p>
                    </div>
                ) : null}
                <AppHeader>
                    <AppTitle>上传</AppTitle>
                    <AppAction>
                        <Button aria-expanded={isUploadPanelOpen} onClick={() => setIsUploadPanelOpen((open) => !open)}>
                            <Upload className="size-4" />
                            上传
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            tooltip="打开上传目录"
                            aria-label="打开上传目录"
                            isLoading={isRevealing}
                            onClick={reveal}
                        >
                            <FolderOpen className="size-4" />
                        </Button>
                    </AppAction>
                </AppHeader>
                <AppContent isScrollable>
                    {/* 上传区本身就是按钮：点击走宿主选择器，拖拽与粘贴由根节点的处理器接管 */}
                    {isUploadPanelOpen ? (
                        <Button
                            variant="outline"
                            aria-label="选择文件上传"
                            className="mt-1 mb-3 h-auto w-full flex-col gap-2 border-dashed py-8"
                            disabled={isUploading}
                            onClick={pickFiles}
                        >
                            <Upload className="size-6" />
                            <span className="text-sm font-medium">{isUploading ? '正在上传…' : '点击选择文件'}</span>
                            <span className="text-muted-foreground text-xs">也可以把文件拖进来，或直接粘贴</span>
                        </Button>
                    ) : null}
                    <ImageList
                        mode="grouped"
                        groups={groups}
                        columns="compact"
                        aspect="3/4"
                        captionPlacement="none"
                        dimOnHover="light"
                        isLoading={isLoading}
                        states={LIST_STATES}
                        paging={{ mode: 'none' }}
                        actions={uploadActions}
                        onActivate={(item) => insert(item.source.path)}
                    />
                </AppContent>
            </AppPage>

            <ConfirmDialog
                open={pendingRemove !== null}
                title="删除这个文件？"
                description="文件会移入系统回收站；正文里引用它的位置将显示破图。"
                confirmLabel="删除"
                isDestructive
                isSubmitting={isRemoving}
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingRemove(null)
                    }
                }}
                onConfirm={() => {
                    if (pendingRemove !== null) {
                        remove(pendingRemove.path)
                    }
                    setPendingRemove(null)
                }}
            />
        </>
    )
}
