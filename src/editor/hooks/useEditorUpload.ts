/**
 * 编辑器内上传：粘贴或拖拽文件时先走 upload/bytes 落盘，再把引用插进正文。
 * 复用约定：与上传页共用同一协议、同一目录（uploads/{YYYYMM}），文件命名与落盘全部由上传模块负责，
 * 编辑器只负责「发起上传」与「插入引用」，自己不写磁盘、不生成文件名；
 * 上传进度与结果用 sonner 提示，同一次上传共用一个 toast id，不额外渲染常驻状态。
 * 关键约束：只接管「带文件」的粘贴与拖拽——纯文本粘贴必须原样放行，否则复制正文会失效；
 * 监听必须挂在捕获阶段并阻止冒泡，否则 ProseMirror 会先把图片当成 URL 或 HTML 处理掉。
 */
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type { UploadFileItem, UploadResult } from '@shared/types/upload'
import { request } from '@shared/utils/bridge'
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'
import type { Editor } from '@tiptap/react'

/** 上传超时：与上传页一致，按单批整体计时 */
const UPLOAD_TIMEOUT_MS = 60_000

/**
 * 单件体积与单批数量上限：与宿主 uploadPayload 的 MAX_UPLOAD_BYTES / MAX_UPLOAD_COUNT 对齐。
 * 在读取前就要拦住，FileReader 会把整个文件读成 base64，超限文件在 webview 侧就已经把内存吃掉了，
 * 等宿主解码后拒绝来不及。改这里必须同步宿主常量。
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILE_COUNT = 20

/** 读文件为 data URL：失败返回 null，由调用方汇总成一条错误 */
function readAsDataUrl(file: File): Promise<string | null> {
    return new Promise<string | null>((resolve): void => {
        const reader = new FileReader()
        reader.onload = (): void => {
            resolve(typeof reader.result === 'string' ? reader.result : null)
        }
        reader.onerror = (): void => {
            resolve(null)
        }
        reader.readAsDataURL(file)
    })
}

export function useEditorUpload(editor: Editor | null): void {
    /** 插入上传结果：url 非空即图片（宿主按扩展名签发），否则退化成链接文本 */
    const insertUploaded = useCallback(
        (items: readonly UploadFileItem[]): void => {
            // 上传期间文档可能已切走或编辑器已销毁：此时文件已经落盘，插入失败不能当成上传失败提示
            if (editor === null || editor.isDestroyed) {
                return
            }
            for (const item of items) {
                const ref = `${ZHAI_PATH_PREFIX}${item.path}`
                if (item.url !== null) {
                    editor
                        .chain()
                        .focus()
                        .insertContent({ type: 'image', attrs: { src: ref, alt: item.name } })
                        .run()
                    continue
                }
                editor.chain().focus().insertContent(`[${item.name}](${ref})`).run()
            }
        },
        [editor],
    )

    useEffect(() => {
        if (editor === null) {
            return
        }
        const dom = editor.view.dom

        const upload = (files: readonly File[]): void => {
            // 读取前先按宿主上限过滤：超限文件一旦交给 FileReader 就已成倍占用内存，宿主再拒绝也来不及
            const accepted = files
                .slice(0, MAX_FILE_COUNT)
                .filter((file) => file.size > 0 && file.size <= MAX_FILE_BYTES)
            const dropped = files.length - accepted.length
            if (accepted.length === 0) {
                toast.error(`文件为空或超过 ${String(MAX_FILE_BYTES / 1024 / 1024)} MB，已取消上传`)
                return
            }
            if (dropped > 0) {
                toast.warning(
                    `已跳过 ${String(dropped)} 个文件：超过 ${String(MAX_FILE_BYTES / 1024 / 1024)} MB 或单批最多 ${String(MAX_FILE_COUNT)} 个`,
                )
            }
            void (async (): Promise<void> => {
                const toastId = toast.loading('正在上传文件…')
                try {
                    const uploadItems: Array<{ name: string; dataBase64: string }> = []
                    for (const file of accepted) {
                        const dataBase64 = await readAsDataUrl(file)
                        if (dataBase64 !== null) {
                            uploadItems.push({ name: file.name, dataBase64 })
                        }
                    }
                    if (uploadItems.length === 0) {
                        toast.error('文件读取失败，请重试', { id: toastId })
                        return
                    }
                    const result = await request<UploadResult>(
                        'upload/bytes',
                        { items: uploadItems },
                        UPLOAD_TIMEOUT_MS,
                    )
                    // 宿主逐条回报跳过原因：全失败必须说失败，部分失败要在成功文案里带出数量
                    const skipped = result.skipped.length
                    if (result.uploaded.length === 0) {
                        toast.error(skipped > 0 ? `${String(skipped)} 个文件未能上传` : '没有文件被上传', {
                            id: toastId,
                        })
                        return
                    }
                    insertUploaded(result.uploaded)
                    toast.success(
                        skipped > 0
                            ? `已插入 ${String(result.uploaded.length)} 个文件，${String(skipped)} 个失败`
                            : `已插入 ${String(result.uploaded.length)} 个文件`,
                        { id: toastId },
                    )
                } catch (cause) {
                    // 带出真实原因：之前只显示通用文案，把「协议没人处理」这类错误藏在里面无法排查
                    const reason = cause instanceof Error ? cause.message : String(cause)
                    toast.error(`上传失败：${reason}`, { id: toastId })
                }
            })()
        }

        const handlePaste = (event: ClipboardEvent): void => {
            // 只读文档不接管：文件会真实落盘却插不进正文，留下一份孤儿文件还提示成功
            if (!editor.isEditable) {
                return
            }
            const files = Array.from(event.clipboardData?.files ?? [])
            if (files.length === 0) {
                return
            }
            event.preventDefault()
            event.stopPropagation()
            upload(files)
        }

        const handleDrop = (event: DragEvent): void => {
            if (!editor.isEditable) {
                return
            }
            const files = Array.from(event.dataTransfer?.files ?? [])
            if (files.length === 0) {
                return
            }
            event.preventDefault()
            event.stopPropagation()
            upload(files)
        }

        dom.addEventListener('paste', handlePaste, true)
        dom.addEventListener('drop', handleDrop, true)
        return (): void => {
            dom.removeEventListener('paste', handlePaste, true)
            dom.removeEventListener('drop', handleDrop, true)
        }
    }, [editor, insertUploaded])
}
