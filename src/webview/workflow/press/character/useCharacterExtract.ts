/**
 * 人物卡提取：请宿主从当前作品的导入素材里生成人物卡草案，进度经 press-semantic 通道回传。
 * 复用约定：请求与状态订阅走 webview 公共 bridge，提示统一经 sonner，进度与结果共用同一条 toast；
 * 分类与性别的枚举归一不在本模块，由页面侧按 constants 的中文标签转换。
 * 关键约束：提取是逐批调用模型的长任务，请求超时须按批数放宽；
 * 返回的只是草案，是否合并进人物列表由调用方决定，本模块不写草稿也不落盘。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PressExtractCharactersResult } from '@shared/types/press'
import { onState, request } from '../../../bridge'

/** 进度与结果共用的 toast id：同一轮提取始终更新同一条提示 */
const EXTRACT_TOAST_ID = 'press-character-extract'

/** 请求超时：角色卡每批 4 人、单批最长 120s，按上限留足余量 */
const EXTRACT_TIMEOUT_MS = 600_000

/** 角色卡阶段的进度载荷：只取提示所需字段 */
interface CharacterProgressPayload {
    stage: 'characters'
    status: string
    dirPath: string
    message: string
}

/** 收窄角色卡阶段的进度载荷：字段不全会直接跳过，不打断其它通道的消息 */
function isCharacterProgress(value: unknown): value is CharacterProgressPayload {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as { stage?: unknown; status?: unknown; dirPath?: unknown; message?: unknown }
    return (
        candidate.stage === 'characters' &&
        typeof candidate.status === 'string' &&
        typeof candidate.dirPath === 'string' &&
        typeof candidate.message === 'string'
    )
}

export interface CharacterExtractState {
    isExtracting: boolean
    /** 发起提取：成功返回草案与提示文案，失败或无结果时返回 null（原因经 sonner 提示） */
    extract: () => Promise<PressExtractCharactersResult | null>
}

export function useCharacterExtract(dirPath: string): CharacterExtractState {
    const [isExtracting, setIsExtracting] = useState(false)
    /** 进行中标记：按钮禁用依赖 state，重复提交拦截依赖 ref，避免闭包里读到旧值 */
    const isExtractingRef = useRef(false)

    // 进度广播只更新提示文案：逐批生成时用户能看到「角色卡 2/5」这类推进
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'press-semantic' || !isCharacterProgress(message.payload)) {
                return
            }
            if (message.payload.dirPath !== dirPath || message.payload.status !== 'running') {
                return
            }
            toast.loading(message.payload.message, { id: EXTRACT_TOAST_ID })
        })
    }, [dirPath])

    const extract = useCallback(async (): Promise<PressExtractCharactersResult | null> => {
        if (isExtractingRef.current) {
            return null
        }
        isExtractingRef.current = true
        setIsExtracting(true)
        toast.loading('正在提取人物卡…', { id: EXTRACT_TOAST_ID })
        try {
            const result = await request<PressExtractCharactersResult>(
                'press/extract/characters',
                { dirPath },
                EXTRACT_TIMEOUT_MS,
            )
            toast.dismiss(EXTRACT_TOAST_ID)
            return result
        } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : String(cause), { id: EXTRACT_TOAST_ID })
            return null
        } finally {
            isExtractingRef.current = false
            setIsExtracting(false)
        }
    }, [dirPath])

    return { isExtracting, extract }
}
