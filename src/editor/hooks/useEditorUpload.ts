/**
 * 编辑器内上传：粘贴或拖拽文件时先走 upload/bytes 落盘，再把引用插进正文。
 * 复用约定：与上传页共用同一协议、同一目录（uploads/{YYYYMM}），文件命名与落盘全部由上传模块负责，
 * 编辑器只负责「发起上传」与「插入引用」，自己不写磁盘、不生成文件名。
 * 关键约束：只接管「带文件」的粘贴与拖拽——纯文本粘贴必须原样放行，否则复制正文会失效；
 * 监听必须挂在捕获阶段并阻止冒泡，否则 ProseMirror 会先把图片当成 URL 或 HTML 处理掉。
 */
import { useCallback, useEffect, useState } from 'react'
import type { UploadFileItem, UploadResult } from '@shared/types/upload'
import { request } from '@shared/utils/bridge'
import { ZHAI_PATH_PREFIX } from '@shared/utils/zhaiPath'
import type { Editor } from '@tiptap/react'

/** 上传超时：与上传页一致，按单批整体计时 */
const UPLOAD_TIMEOUT_MS = 60_000

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

export interface UseEditorUploadResult {
    isUploading: boolean
    error: string | null
}

export function useEditorUpload(editor: Editor | null): UseEditorUploadResult {
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    /** 插入上传结果：url 非空即图片（宿主按扩展名签发），否则退化成链接文本 */
    const insertUploaded = useCallback(
        (items: readonly UploadFileItem[]): void => {
            if (editor === null) {
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
            void (async (): Promise<void> => {
                setIsUploading(true)
                setError(null)
                try {
                    const uploadItems: Array<{ name: string; dataBase64: string }> = []
                    for (const file of files) {
                        const dataBase64 = await readAsDataUrl(file)
                        if (dataBase64 !== null) {
                            uploadItems.push({ name: file.name, dataBase64 })
                        }
                    }
                    if (uploadItems.length === 0) {
                        setError('文件读取失败，请重试')
                        return
                    }
                    const result = await request<UploadResult>(
                        'upload/bytes',
                        { items: uploadItems },
                        UPLOAD_TIMEOUT_MS,
                    )
                    insertUploaded(result.uploaded)
                } catch (cause) {
                    // 带出真实原因：之前只显示通用文案，把「协议没人处理」这类错误藏在里面无法排查
                    const reason = cause instanceof Error ? cause.message : String(cause)
                    setError(`上传失败：${reason}`)
                } finally {
                    setIsUploading(false)
                }
            })()
        }

        const handlePaste = (event: ClipboardEvent): void => {
            const files = Array.from(event.clipboardData?.files ?? [])
            if (files.length === 0) {
                return
            }
            event.preventDefault()
            event.stopPropagation()
            upload(files)
        }

        const handleDrop = (event: DragEvent): void => {
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

    return { isUploading, error }
}
