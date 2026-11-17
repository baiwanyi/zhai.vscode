/**
 * 待发送参考图：把选择器回传的图片暂存在页面内，供对话发送时随请求提交。
 * 复用约定：条目来自宿主的选择流程（AiChatImageReferencePicker 的回调），本层只做增删与上限判定，
 * 不拼磁盘路径、不读文件；路径是否可读由宿主参考图服务按登记表校验。
 * 关键约束：路径是图片的唯一可信标识，同一路径只挂一次；上限与宿主读取口径一致（3 张），
 * 达到后输入卡片的按钮禁用；发送成功后由调用方清空，发送失败保留以便重试。
 */
import { useCallback, useState } from 'react'
import type { ImageReferenceItem } from '@shared/types/imageReference'

/** 参考图张数上限：与宿主参考图服务的读取上限一致，超出会被丢弃 */
const MAX_REFERENCE_IMAGES = 3

export interface UseAiChatReferenceImagesResult {
    /** 待发送参考图：按选择顺序排列 */
    references: ImageReferenceItem[]
    /** 已达上限：工具栏按钮据此禁用 */
    isFull: boolean
    add: (reference: ImageReferenceItem) => void
    /** 按路径摘除：芯片移除与重复选择共用同一标识 */
    remove: (path: string) => void
    clear: () => void
}

export function useAiChatReferenceImages(): UseAiChatReferenceImagesResult {
    const [references, setReferences] = useState<ImageReferenceItem[]>([])

    const add = useCallback((reference: ImageReferenceItem): void => {
        setReferences((previous) =>
            previous.some((item) => item.path === reference.path) || previous.length >= MAX_REFERENCE_IMAGES
                ? previous
                : [...previous, reference],
        )
    }, [])

    const remove = useCallback((path: string): void => {
        setReferences((previous) => previous.filter((item) => item.path !== path))
    }, [])

    const clear = useCallback((): void => {
        setReferences([])
    }, [])

    return { references, isFull: references.length >= MAX_REFERENCE_IMAGES, add, remove, clear }
}
