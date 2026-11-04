/**
 * 上传页：独立常驻分区，承接选择文件、拖拽与粘贴三条通道，并展示 uploads 目录下已上传的文件。
 * 入口在侧栏导航，作品、笔记、公众号与普通文档共用同一页——上传与内容归属无关。
 * 复用约定：外壳取 @webview/components/AppPage，清单与上传动作由 useUploader 统一持有；
 * 列表走统一图片列表 ImageList，条目经 imageListAdapters 映射、按月分组取 hooks/mediaMonth，
 * 复制路径走 @shared/utils/clipboard 并按正文引用口径补 @zhai/ 前缀。
 * 关键约束：文件落 {存储根}/uploads/{YYYYMM}/，文件名由宿主生成，页面不提供重命名与删除；
 * 本页与媒体页只共用列表组件、不共用数据源；上传成功后只静默重拉清单，不做乐观插入。
 */
import { FolderOpen, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import type { UploadFileItem } from '@shared/types/upload'
import { UPLOAD_DIR } from '@shared/types/upload'
import { copyToClipboard } from '@shared/utils/clipboard'
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { groupByMonth } from './hooks/mediaMonth'
import { useUploader } from './hooks/useUploader'
import { ImageList } from './layout/imageList/ImageList'
import { toImageListGroups, toUploadFileItem } from './layout/imageList/imageListAdapters'
import type { ImageListStates } from './layout/imageList/imageListModel'
import type { JSX } from 'react'

/** 上传区文案：说明落盘规则，避免用户去别处找文件 */
const UPLOAD_RULE_TEXT = `文件保存到 ${UPLOAD_DIR}/YYYYMM/ 目录，文件名 = 年月日时分秒 + 6 位随机码`

/** 上传列表状态位：首屏给骨架，空库给引导文案 */
const LIST_STATES: ImageListStates = {
    loadingMode: 'skeleton',
    empty: {
        title: '还没有上传过文件',
        description: '点上方区域选择文件，或把文件直接拖进来、粘贴到页面里。',
        icon: Upload,
    },
}

export function WorkflowUpload(): JSX.Element {
    const { items, isLoading, isUploading, isRevealing, isDragging, dragHandlers, pickFiles, reveal } = useUploader()

    /** 按月分组：入参已按目录倒序，分组与条目映射都走纯函数 */
    const groups = useMemo(() => toImageListGroups(groupByMonth(items), toUploadFileItem), [items])

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

    return (
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
                <AppDescription>{UPLOAD_RULE_TEXT}</AppDescription>
            </AppHeader>
            <AppContent isScrollable>
                {/* 上传区本身就是按钮：点击走宿主选择器，拖拽与粘贴由根节点的处理器接管 */}
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
                <ImageList
                    mode="grouped"
                    groups={groups}
                    columns="compact"
                    aspect="4/3"
                    groupUnit="个"
                    captionPlacement="below"
                    isLoading={isLoading}
                    states={LIST_STATES}
                    paging={{ mode: 'none' }}
                    onActivate={(item) => handleCopyPath(item.source)}
                />
            </AppContent>
        </AppPage>
    )
}
