/**
 * 作品导入动作：选文件、安全校验与试解析、确认弹窗、后台导入，进度经 press-import 通道回传。
 * 复用约定：请求与状态订阅走 ../../../bridge，错误提示统一经 sonner；
 * 进度与终态共用同一个 toast id，避免逐章弹出多条提示把面板刷满。
 * 关键约束：宿主下发的业务原因码经 HostRequestError 传递，文案映射集中在本模块，页面不解析字符串；
 * 导入期间页面保持可交互，取消只请求宿主在章节边界停下，已写章节不回滚。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    PressAudience,
    PressImportCandidate,
    PressImportErrorCode,
    PressImportProgress,
    PressImportStartResult,
} from '@shared/types/press'
import { HostRequestError, onState, request } from '../../../bridge'
import { toastError } from '../../../utils'

/** 进度提示的固定 toast id：同一任务的进度与终态始终更新同一条提示 */
const IMPORT_TOAST_ID = 'press-import'

/** 选文件请求的超时：对话框由用户操作，耗时不可预估，给足 30 分钟避免误判超时 */
const PICK_TIMEOUT_MS = 30 * 60 * 1000

/** 导入失败原因码到用户文案：补上可执行的下一步建议，避免只显示宿主的技术描述 */
const IMPORT_ERROR_MESSAGES: Readonly<Record<PressImportErrorCode, string>> = {
    aborted: '已取消导入',
    'not-file': '请选择一个 .txt 文件，不支持文件夹或快捷方式',
    'bad-extension': '仅支持 .txt 纯文本文件',
    'too-large': '文件超过 50 MB 上限，请拆分后再导入',
    empty: '文件内容为空',
    binary: '文件不是纯文本，无法导入',
    'bad-encoding': '无法识别文件编码，请另存为 UTF-8 后重试',
    'no-chapter': '未识别到章节标题，请确认正文使用「第N章」等标记',
    'single-chapter': '全文被识别为单章，章节标记可能不规范',
    'bad-project-name': '作品名不合法，请修改后重试',
    'project-exists': '已存在同名作品，请换个名字',
    'write-failed': '章节写入失败，请检查目录权限',
    'partially-failed': '部分章节写入失败，已成功的章节保留',
    internal: '导入失败，请稍后重试',
}

/** 判断字符串是否为已登记的导入错误码，避免用断言把未知码当已知处理 */
function isImportErrorCode(value: string): value is PressImportErrorCode {
    return Object.prototype.hasOwnProperty.call(IMPORT_ERROR_MESSAGES, value)
}

/**
 * 把宿主错误转成用户文案：已知原因码用本模块的可执行文案，其余沿用宿主描述。
 * internal 例外——该码对应未预期异常，宿主的 message 往往才是唯一线索，不能被通用文案盖掉。
 */
function toImportErrorMessage(cause: unknown): string {
    if (cause instanceof HostRequestError && isImportErrorCode(cause.code) && cause.code !== 'internal') {
        return IMPORT_ERROR_MESSAGES[cause.code]
    }
    return cause instanceof Error ? cause.message : String(cause)
}

/** 判断是否为导入进度载荷（类型收窄辅助）：只校验分派所需的最小字段 */
function isProgressPayload(value: unknown): value is PressImportProgress {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as { jobId?: unknown; status?: unknown }
    return typeof candidate.jobId === 'string' && typeof candidate.status === 'string'
}

export interface PressImportState {
    /** 已通过安全校验与试解析、等待用户确认的候选文件 */
    candidate: PressImportCandidate | null
    isImporting: boolean
    /** 选文件并预检：用户取消或校验失败时保持候选为空 */
    pick: () => Promise<void>
    /** 按确认后的作品名启动导入，返回是否已成功启动 */
    start: (name: string, audience: PressAudience) => Promise<boolean>
    /** 取消进行中的导入：宿主在下一个章节边界停下 */
    cancel: () => Promise<void>
    /** 关闭确认弹窗并丢弃候选 */
    dismiss: () => void
}

export interface PressImportOptions {
    /** 导入成功后的回调：页面据此决定是否继续触发语义归纳 */
    onCompleted?: (dirPath: string) => void
}

export function usePressImport(options: PressImportOptions = {}): PressImportState {
    const [candidate, setCandidate] = useState<PressImportCandidate | null>(null)
    const [isImporting, setIsImporting] = useState(false)
    /** 当前任务的 jobId：用于过滤旧任务的迟到进度 */
    const jobIdRef = useRef('')
    /** 完成回调走 ref：避免回调身份变化导致整个订阅重挂 */
    const completedRef = useRef(options.onCompleted)

    useEffect(() => {
        completedRef.current = options.onCompleted
    }, [options.onCompleted])

    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'press-import' || !isProgressPayload(message.payload)) {
                return
            }
            const progress = message.payload
            if (progress.jobId !== jobIdRef.current) {
                return
            }
            if (progress.status === 'running') {
                toast.loading(progress.message, { id: IMPORT_TOAST_ID })
                return
            }
            jobIdRef.current = ''
            setIsImporting(false)
            if (progress.status === 'completed') {
                setCandidate(null)
                toast.success(progress.message, { id: IMPORT_TOAST_ID })
                completedRef.current?.(progress.dirPath)
                return
            }
            if (progress.status === 'cancelled') {
                toast.info(progress.message, { id: IMPORT_TOAST_ID })
                return
            }
            toast.error(progress.message, { id: IMPORT_TOAST_ID })
        })
    }, [])

    const pick = useCallback(async (): Promise<void> => {
        try {
            const next = await request<PressImportCandidate | null>('press/import/pick', undefined, PICK_TIMEOUT_MS)
            setCandidate(next)
        } catch (cause) {
            toast.error(toImportErrorMessage(cause))
        }
    }, [])

    const start = useCallback(
        async (name: string, audience: PressAudience): Promise<boolean> => {
            if (candidate === null) {
                return false
            }
            setIsImporting(true)
            toast.loading('正在准备导入…', { id: IMPORT_TOAST_ID })
            try {
                const started = await request<PressImportStartResult>('press/import/start', {
                    token: candidate.token,
                    name,
                    audience,
                })
                jobIdRef.current = started.jobId
                return true
            } catch (cause) {
                setIsImporting(false)
                toast.error(toImportErrorMessage(cause), { id: IMPORT_TOAST_ID })
                return false
            }
        },
        [candidate],
    )

    const cancel = useCallback(async (): Promise<void> => {
        const jobId = jobIdRef.current
        if (jobId.length === 0) {
            return
        }
        try {
            await request('press/import/cancel', { jobId })
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    const dismiss = useCallback((): void => {
        setCandidate(null)
    }, [])

    return { candidate, isImporting, pick, start, cancel, dismiss }
}
