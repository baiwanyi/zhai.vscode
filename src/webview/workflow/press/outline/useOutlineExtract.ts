/**
 * 大纲提取：请宿主用已落盘的导入素材重建卷与章（卷名、章序、梗概、钩子、张力）。
 * 复用约定：请求经 @shared/utils/bridge，提示统一经 sonner；返回草案，转换成大纲树由 utils 负责。
 * 关键约束：提取不调用模型，因此没有进度广播、也不依赖 AI 登录态；素材为空时由宿主先补跑本地抽取，
 * 所以首次提取可能多花数秒，超时须按全部章节放宽。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PressExtractOutlineResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 过程提示的固定 toast id：同一轮提取始终更新同一条提示 */
const EXTRACT_TOAST_ID = 'press-outline-extract'

/** 请求超时：可能先遍历全部章节补抽素材，长作品需要数十秒 */
const EXTRACT_TIMEOUT_MS = 300_000

export interface OutlineExtractState {
    isExtracting: boolean
    /** 发起提取：成功返回草案与提示文案，失败或无结果时返回 null（原因经 sonner 提示） */
    extract: () => Promise<PressExtractOutlineResult | null>
}

export function useOutlineExtract(dirPath: string): OutlineExtractState {
    const [isExtracting, setIsExtracting] = useState(false)
    /** 进行中标记：按钮禁用依赖 state，重复提交拦截依赖 ref，避免闭包里读到旧值 */
    const isExtractingRef = useRef(false)

    const extract = useCallback(async (): Promise<PressExtractOutlineResult | null> => {
        if (isExtractingRef.current) {
            return null
        }
        isExtractingRef.current = true
        setIsExtracting(true)
        toast.loading('正在按素材重建大纲…', { id: EXTRACT_TOAST_ID })
        try {
            const result = await request<PressExtractOutlineResult>(
                'press/extract/outline',
                { dirPath },
                EXTRACT_TIMEOUT_MS,
            )
            toast.dismiss(EXTRACT_TOAST_ID)
            return result
        } catch (cause) {
            toast.error(toErrorText(cause), { id: EXTRACT_TOAST_ID })
            return null
        } finally {
            isExtractingRef.current = false
            setIsExtracting(false)
        }
    }, [dirPath])

    return { isExtracting, extract }
}
