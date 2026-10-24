/**
 * AI 特征检测：读取可用状态（是否配置密钥、是否已同意上传、今日剩余次数），并执行朱雀检测。
 * 复用约定：请求走 @shared/utils/bridge，密钥配置经 host/command 触发宿主输入框，错误统一 sonner 提示。
 * 关键约束：检测前总是重新拉取状态，避免页面停留期间密钥或同意状态已变化；
 * 未配置密钥与未同意上传都不会发出请求；未同意时先弹确认框，用户确认后才写入同意标记并继续；
 * 挂载时先取宿主检测缓存，正文未变即直接展示上次结论，缓存读失败按未检测处理、不打扰用户。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ProofreadAiDetectResult, ProofreadAiDetectState, ProofreadDetectCache } from '@shared/types/proofread'
import { request } from '@shared/utils/bridge'
import { toastError, toErrorText } from '@shared/utils/error'

/** 检测阶段：idle 待检测、running 进行中、done 有结果、error 失败 */
export type ProofreadDetectStage = 'idle' | 'running' | 'done' | 'error'

/** 检测请求等待上限：长章节单次分类通常仍在 10 秒内 */
const DETECT_TIMEOUT_MS = 60_000

/** 宿主密钥配置命令：登记在 Webview 白名单内 */
const CONFIGURE_KEY_COMMAND = 'zhai.proofread.setZhuqueKey'

export interface ProofreadAiDetectViewState {
    stage: ProofreadDetectStage
    /** 可用状态：未加载完成时为 null */
    state: ProofreadAiDetectState | null
    result: ProofreadAiDetectResult | null
    error: string | null
    /** 上传同意弹窗是否打开 */
    isConsentOpen: boolean
    detect: () => Promise<void>
    openConsent: () => void
    closeConsent: () => void
    acceptConsent: () => Promise<void>
    configureKey: () => Promise<void>
}

export function useProofreadAiDetect(): ProofreadAiDetectViewState {
    const [stage, setStage] = useState<ProofreadDetectStage>('idle')
    const [state, setState] = useState<ProofreadAiDetectState | null>(null)
    const [result, setResult] = useState<ProofreadAiDetectResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isConsentOpen, setIsConsentOpen] = useState(false)

    useEffect(() => {
        let isCancelled = false
        const load = async (): Promise<void> => {
            try {
                const next = await request<ProofreadAiDetectState>('proofread/aiDetect/state')
                if (!isCancelled) {
                    setState(next)
                }
            } catch (cause) {
                if (!isCancelled) {
                    setError(toErrorText(cause))
                }
            }
            try {
                const cached = await request<ProofreadDetectCache | null>('proofread/aiDetect/cache')
                if (!isCancelled && cached !== null) {
                    setResult(cached.result)
                    setStage('done')
                }
            } catch {
                // 缓存属于旁路能力：读不到就按未检测处理，不写错误提示
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [])

    /** 执行一次检测：先刷新状态，再按 key / 同意 / 额度顺序拦截 */
    const detect = useCallback(async (): Promise<void> => {
        setError(null)
        let latest: ProofreadAiDetectState
        try {
            latest = await request<ProofreadAiDetectState>('proofread/aiDetect/state')
            setState(latest)
        } catch (cause) {
            setError(toErrorText(cause))
            setStage('error')
            return
        }
        if (!latest.hasKey) {
            toast.warning('尚未配置朱雀 API Key，请先点击「配置密钥」')
            return
        }
        if (!latest.hasConsent) {
            setIsConsentOpen(true)
            return
        }
        if (latest.remaining !== null && latest.remaining <= 0) {
            toast.warning('今日检测次数已用完，可在设置中调整上限')
            return
        }
        setStage('running')
        try {
            const next = await request<ProofreadAiDetectResult | null>(
                'proofread/aiDetect',
                { useSelection: false },
                DETECT_TIMEOUT_MS,
            )
            if (next === null) {
                setStage('idle')
                toast.warning('请先在编辑器中打开要检测的文档')
                return
            }
            setResult(next)
            setStage('done')
            const refreshed = await request<ProofreadAiDetectState>('proofread/aiDetect/state')
            setState(refreshed)
        } catch (cause) {
            setError(toErrorText(cause))
            setStage('error')
        }
    }, [])

    const openConsent = useCallback((): void => {
        setIsConsentOpen(true)
    }, [])

    const closeConsent = useCallback((): void => {
        setIsConsentOpen(false)
    }, [])

    const acceptConsent = useCallback(async (): Promise<void> => {
        try {
            const next = await request<ProofreadAiDetectState>('proofread/aiDetect/consent', { accepted: true })
            setState(next)
            setIsConsentOpen(false)
            await detect()
        } catch (cause) {
            toastError(cause)
        }
    }, [detect])

    const configureKey = useCallback(async (): Promise<void> => {
        try {
            await request('host/command', CONFIGURE_KEY_COMMAND)
            // 输入框在宿主侧异步完成，稍候再刷新一次状态，配置成功后无需手动刷新
            window.setTimeout(() => {
                void request<ProofreadAiDetectState>('proofread/aiDetect/state')
                    .then((next) => setState(next))
                    .catch(() => undefined)
            }, 3_000)
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    return {
        stage,
        state,
        result,
        error,
        isConsentOpen,
        detect,
        openConsent,
        closeConsent,
        acceptConsent,
        configureKey,
    }
}
