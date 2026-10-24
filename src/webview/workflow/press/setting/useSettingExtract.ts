/**
 * 设定提取：请宿主用设定候选章（世界构建与金手指关键词命中章）的三段摘录与章节摘要归纳作品设定，
 * 覆盖世界观总述、地理、势力、规则体系与核心概念，属于一次模型调用。
 * 复用约定：请求经 @shared/utils/bridge，提示统一经 sonner；返回草案，合并规则（只填空字段等）由调用方决定。
 * 关键约束：提取是 AI 任务，前端超时须按宿主单批 120s 放宽；宿主侧产物已存在时直接复用，不会重复扣配额。
 */
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PressExtractSettingResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 过程提示的固定 toast id：同一轮提取始终更新同一条提示 */
const EXTRACT_TOAST_ID = 'press-setting-extract'

/** 请求超时：单批最长 120s，留出素材补抽与排队余量 */
const EXTRACT_TIMEOUT_MS = 240_000

export interface SettingExtractState {
    isExtracting: boolean
    /** 发起提取：成功返回草案与提示文案，失败或无结果时返回 null（原因经 sonner 提示） */
    extract: () => Promise<PressExtractSettingResult | null>
}

export function useSettingExtract(dirPath: string): SettingExtractState {
    const [isExtracting, setIsExtracting] = useState(false)
    /** 进行中标记：按钮禁用依赖 state，重复提交拦截依赖 ref，避免闭包里读到旧值 */
    const isExtractingRef = useRef(false)

    const extract = useCallback(async (): Promise<PressExtractSettingResult | null> => {
        if (isExtractingRef.current) {
            return null
        }
        isExtractingRef.current = true
        setIsExtracting(true)
        toast.loading('正在从素材提取设定…', { id: EXTRACT_TOAST_ID })
        try {
            const result = await request<PressExtractSettingResult>(
                'press/extract/setting',
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
