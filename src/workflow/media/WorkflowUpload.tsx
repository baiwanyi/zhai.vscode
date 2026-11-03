/**
 * 上传页：独立常驻分区，承接选择文件、拖拽与粘贴三条通道，并展示 uploads 目录下已上传的文件。
 * 入口在侧栏导航，作品、笔记、公众号与普通文档共用同一页——上传与内容归属无关。
 * 与媒体页同处 workflow/media 目录：媒体页看 images 索引，本页看 uploads 磁盘清单，两者不共用组件与数据。
 * 复用约定：外壳取 @webview/components/AppPage（规则说明进 AppDescription，打开目录进 AppAction，
 * 文件网格走 AppContent 滚动）；清单与上传动作由 useUploader 统一持有，网格渲染交给 UploadFileGrid；
 * 复制路径写剪贴板走 @shared/utils/clipboard，路径按正文引用口径补 @zhai/ 前缀。
 * 关键约束：文件落 {存储根}/uploads/{YYYYMM}/，文件名由宿主生成（年月日时分秒 + 6 位随机码），
 * 页面不提供重命名与删除，本页只负责上传与查看；
 * 上传成功后只静默重拉清单，不做乐观插入；拖拽高亮层与网格共用一个根节点，不额外套壳。
 */
import { FolderOpen, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { UploadFileItem } from '@shared/types/upload'
import { UPLOAD_DIR } from '@shared/types/upload'
import { copyToClipboard } from '@shared/utils/clipboard'
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { useUploader } from './hooks/useUploader'
import { UploadFileGrid } from './layout/UploadFileGrid'
import type { JSX } from 'react'

/** 上传区文案：说明落盘规则，避免用户去别处找文件 */
const UPLOAD_RULE_TEXT = `文件保存到 ${UPLOAD_DIR}/YYYYMM/ 目录，文件名 = 年月日时分秒 + 6 位随机码`

export function WorkflowUpload(): JSX.Element {
    const { items, isLoading, isUploading, isRevealing, isDragging, dragHandlers, pickFiles, reveal } = useUploader()

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
                <UploadFileGrid items={items} isLoading={isLoading} onCopyPath={handleCopyPath} />
            </AppContent>
        </AppPage>
    )
}
