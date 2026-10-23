/**
 * 人物卡提取：请宿主从当前作品的导入素材里生成人物卡草案，进度经 press-semantic 通道回传。
 * 复用约定：请求与状态订阅走 webview 公共 bridge，进度只在本层转成状态供页面渲染，提示只用 sonner 报错；
 * 分类与性别的枚举归一不在本模块，由页面侧按 constants 的中文标签转换。
 * 关键约束：提取是逐批调用模型的长任务，请求超时须按批数放宽；
 * 返回的只是草案，是否合并进人物列表由调用方决定，本模块不写草稿也不落盘；
 * 进度文案由宿主给出（形如「角色卡 3/5」），本层不自行拼接，避免两边口径不一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PressExtractCharactersResult } from '@shared/types/press'
import { onState, request } from '../../../bridge'

/** 请求超时：角色卡每批 4 人、单批最长 120s，按上限留足余量 */
const EXTRACT_TIMEOUT_MS = 600_000

/** 初始进度文案：宿主首批回传前先给出一句占位，界面不至于空着 */
const PENDING_MESSAGE = '正在提取人物卡…'

/** 当前进度：message 直接来自宿主，供列表区展示 */
export interface CharacterExtractProgress {
    message: string
    done: number
    total: number
}

/** 角色卡阶段的进度载荷：只取展示所需字段 */
interface CharacterProgressPayload {
    stage: 'characters'
    status: string
    dirPath: string
    message: string
    done: number
    total: number
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
    /** 提取进度：未在提取时为 null，界面据此决定是否整块替换为加载态 */
    progress: CharacterExtractProgress | null
    /** 发起提取：成功返回草案与提示文案，失败或无结果时返回 null（原因经 sonner 提示） */
    extract: () => Promise<PressExtractCharactersResult | null>
}

export function useCharacterExtract(dirPath: string): CharacterExtractState {
    const [isExtracting, setIsExtracting] = useState(false)
    const [progress, setProgress] = useState<CharacterExtractProgress | null>(null)
    /** 进行中标记：按钮禁用依赖 state，重复提交拦截依赖 ref，避免闭包里读到旧值 */
    const isExtractingRef = useRef(false)

    // 进度广播只更新界面状态：逐批生成时用户能看到「角色卡 2/5」这类推进，不再弹 toast
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'press-semantic' || !isCharacterProgress(message.payload)) {
                return
            }
            if (message.payload.dirPath !== dirPath || message.payload.status !== 'running') {
                return
            }
            setProgress({
                message: message.payload.message,
                done: typeof message.payload.done === 'number' ? message.payload.done : 0,
                total: typeof message.payload.total === 'number' ? message.payload.total : 0,
            })
        })
    }, [dirPath])

    const extract = useCallback(async (): Promise<PressExtractCharactersResult | null> => {
        if (isExtractingRef.current) {
            return null
        }
        isExtractingRef.current = true
        setIsExtracting(true)
        setProgress({ message: PENDING_MESSAGE, done: 0, total: 0 })
        try {
            return await request<PressExtractCharactersResult>(
                'press/extract/characters',
                { dirPath },
                EXTRACT_TIMEOUT_MS,
            )
        } catch (cause) {
            // 失败没有界面承载点，仍用 sonner 给出原因
            toast.error(cause instanceof Error ? cause.message : String(cause))
            return null
        } finally {
            isExtractingRef.current = false
            setIsExtracting(false)
            setProgress(null)
        }
    }, [dirPath])

    return { isExtracting, progress, extract }
}
