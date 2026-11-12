/**
 * 打开作品文档：设定、人物与大纲页右上角的「打开文档」共用，把分组或页面折算成文档键交给宿主打开。
 * 复用约定：请求经 @shared/utils/bridge 的 press/openDoc，失败原因统一由 toastError 提示，
 * 不向组件回传错误状态，也不在本地维护打开进度（编辑器打开是瞬时动作）。
 * 关键约束：前端只传 PressDocKey，真实文件名由宿主白名单映射，避免把文档名当路径传递；
 * 文档尚未生成时宿主抛可读错误，这里只提示，不代建文件——建文档要走各页自己的保存通道。
 */
import { useCallback } from 'react'
import type { OpenPressProjectResult, PressDocKey } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export interface OpenProjectDocState {
    /** 在编辑器中打开该作品下的目标文档 */
    openDoc: (doc: PressDocKey) => void
}

export function useOpenProjectDoc(dirPath: string): OpenProjectDocState {
    const openDoc = useCallback(
        (doc: PressDocKey): void => {
            const run = async (): Promise<void> => {
                try {
                    await request<OpenPressProjectResult>('press/openDoc', { dirPath, doc })
                } catch (cause) {
                    toastError(cause)
                }
            }
            void run()
        },
        [dirPath],
    )

    return { openDoc }
}
