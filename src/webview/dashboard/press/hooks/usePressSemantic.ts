/**
 * 作品语义归纳动作：对指定作品分批生成章节摘要，进度经 press-semantic 通道回传。
 * 复用约定：请求与状态订阅走 ../../../bridge，提示统一经 sonner，
 * 进度与终态共用同一个 toast id，避免逐批弹出多条提示。
 * 关键约束：宿主返回的业务原因码经 HostRequestError 传递，文案映射集中在本模块；
 * 归纳是长任务，启动请求只取 jobId，进度与终态一律等广播，不依赖请求返回值。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PressSemanticErrorCode, PressSemanticProgress, PressSemanticStartResult } from '@shared/types/press'
import { HostRequestError, onState, request } from '../../../bridge'

/** 进度提示的固定 toast id：同一任务的进度与终态始终更新同一条提示 */
const SEMANTIC_TOAST_ID = 'press-semantic'

/** 归纳失败原因码到用户文案：补上可执行的下一步建议 */
const SEMANTIC_ERROR_MESSAGES: Readonly<Record<PressSemanticErrorCode, string>> = {
    aborted: '已取消归纳',
    'not-ready': 'AI 通道未就绪，请先在对话面板登录或检查站点配置',
    'no-material': '未找到章节素材，请重新导入该作品后再试',
    'no-chapters': '作品下没有可归纳的章节',
    'quota-exceeded': '今日归纳次数已用完，已生成部分保留，调大限额或明日续跑',
    internal: '归纳失败，请稍后重试',
}

/** 判断字符串是否为已登记的归纳错误码 */
function isSemanticErrorCode(value: string): value is PressSemanticErrorCode {
    return Object.prototype.hasOwnProperty.call(SEMANTIC_ERROR_MESSAGES, value)
}

/** 把宿主错误转成用户文案：internal 保留宿主 message 作为排查线索 */
function toSemanticErrorMessage(cause: unknown): string {
    if (cause instanceof HostRequestError && isSemanticErrorCode(cause.code) && cause.code !== 'internal') {
        return SEMANTIC_ERROR_MESSAGES[cause.code]
    }
    return cause instanceof Error ? cause.message : String(cause)
}

/** 判断是否为归纳进度载荷：只校验分派所需的最小字段 */
function isProgressPayload(value: unknown): value is PressSemanticProgress {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as { jobId?: unknown; status?: unknown }
    return typeof candidate.jobId === 'string' && typeof candidate.status === 'string'
}

export interface PressSemanticState {
    isRunning: boolean
    /**
     * 启动摘要归纳：同一时刻只允许一个任务。
     * 传 targetDirPath 时忽略构造入参——导入流程要在列表页对刚建好的作品直接续跑。
     */
    start: (targetDirPath?: string) => Promise<void>
    /** 取消进行中的归纳：宿主在下一个批次边界停下 */
    cancel: () => Promise<void>
}

export function usePressSemantic(dirPath: string): PressSemanticState {
    const [isRunning, setIsRunning] = useState(false)
    /** 当前任务的 jobId：用于过滤旧任务的迟到进度 */
    const jobIdRef = useRef('')

    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'press-semantic' || !isProgressPayload(message.payload)) {
                return
            }
            const progress = message.payload
            if (progress.jobId !== jobIdRef.current) {
                return
            }
            if (progress.status === 'running') {
                toast.loading(progress.message, { id: SEMANTIC_TOAST_ID })
                return
            }
            jobIdRef.current = ''
            setIsRunning(false)
            if (progress.status === 'completed') {
                toast.success(progress.message, { id: SEMANTIC_TOAST_ID })
                return
            }
            if (progress.status === 'cancelled') {
                toast.info(progress.message, { id: SEMANTIC_TOAST_ID })
                return
            }
            toast.error(progress.message, { id: SEMANTIC_TOAST_ID })
        })
    }, [])

    const start = useCallback(
        async (targetDirPath?: string): Promise<void> => {
            if (isRunning) {
                return
            }
            setIsRunning(true)
            toast.loading('正在准备归纳…', { id: SEMANTIC_TOAST_ID, duration: Infinity })
            try {
                const resolved = targetDirPath !== undefined && targetDirPath.length > 0 ? targetDirPath : dirPath
                const started = await request<PressSemanticStartResult>('press/semantic/start', {
                    dirPath: resolved,
                })
                jobIdRef.current = started.jobId
            } catch (cause) {
                setIsRunning(false)
                toast.error(toSemanticErrorMessage(cause), { id: SEMANTIC_TOAST_ID })
            }
        },
        [dirPath, isRunning],
    )

    const cancel = useCallback(async (): Promise<void> => {
        const jobId = jobIdRef.current
        if (jobId.length === 0) {
            return
        }
        try {
            await request('press/semantic/cancel', { jobId })
        } catch (cause) {
            toast.error(toSemanticErrorMessage(cause), { id: SEMANTIC_TOAST_ID })
        }
    }, [])

    return { isRunning, start, cancel }
}
