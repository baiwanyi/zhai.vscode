/**
 * 校对运行：先跑本地规则（毫秒级、可离线），再串行跑 AI 语义检查，维护忽略集合并提供定位、应用与取消。
 * 复用约定：请求走 @shared/utils/bridge（方法名受 HostMethodName 约束），AI 进度经 state 的 proofread 通道回流；
 * 错误经 sonner 提示，目标就绪与否由宿主返回 null 表达，前端据此展示引导空态而不是报错。
 * 关键约束：每次检查都由宿主重新读编辑器正文，前端不缓存文本；AI 结果带回文档版本号，
 * 与本地结果版本不一致时整批丢弃，避免把旧偏移标到新正文上；AI 条目与本地重叠时保留本地；
 * 进入页面先取宿主缓存（正文未变即直接还原上次结果），没有缓存才跑本地规则；
 * 切换检查范围与写回后只重跑本地，AI 语义检查只由「开始校对」显式触发；
 * 还原后的 target 不含正文，仅用于展示与偏移换算，写回与定位仍由宿主回查文档。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isProofreadAiProgress } from '@shared/types/proofread'
import type {
    ProofreadAbortResult,
    ProofreadAiResult,
    ProofreadApplyResult,
    ProofreadCache,
    ProofreadIssue,
    ProofreadRunResult,
    ProofreadTarget,
} from '@shared/types/proofread'
import { onState, request } from '@shared/utils/bridge'
import { toastError, toErrorText } from '@shared/utils/error'

/** 本地检查状态：loading 读取目标、empty 无目标、running 检查中、ready 有结果、error 失败 */
export type ProofreadStatus = 'loading' | 'empty' | 'running' | 'ready' | 'error'

/** AI 检查阶段：与本地状态分离，AI 失败不影响已出结果 */
export type ProofreadAiStage = 'idle' | 'running' | 'done' | 'error'

/** 运行方式：local 只跑本地规则，full 额外串行跑 AI 语义与风险段落检查 */
export type ProofreadRunMode = 'local' | 'full'

/**
 * AI 请求的整体等待上限：必须大于宿主侧的批次预算（240s），
 * 否则会出现宿主仍在跑、前端已按超时丢弃结果的情况。
 */
const AI_TIMEOUT_MS = 300_000

/** 取消请求的等待上限：宿主无响应时不能把按钮永久钉在加载态 */
const ABORT_TIMEOUT_MS = 10_000

/** 批次进度 */
export interface ProofreadProgress {
    batch: number
    total: number
}

export interface ProofreadRunState {
    status: ProofreadStatus
    target: ProofreadTarget | null
    /** 合并本地与 AI 结果、并剔除忽略项后的条目 */
    visibleIssues: readonly ProofreadIssue[]
    aiStage: ProofreadAiStage
    aiProgress: ProofreadProgress | null
    aiIssueCount: number
    failedBatches: number
    /** 超出宿主时长预算而未执行的批次数 */
    skippedBatches: number
    aiError: string | null
    /** 被忽略词放过的命中数 */
    suppressed: number
    elapsedMs: number
    errorText: string | null
    shouldUseSelection: boolean
    isAiEnabled: boolean
    isApplying: boolean
    /** 取消请求已发出：按钮显示加载态，直到 AI 阶段真正收尾 */
    isAborting: boolean
    /** 本地或 AI 任一阶段进行中 */
    isRunning: boolean
    /** 已有可用结果（还原自缓存或已跑过完整校对）：按钮据此显示「重新校对」 */
    hasResult: boolean
    /** 可一键写回的条目数 */
    fixableCount: number
    setShouldUseSelection: (value: boolean) => void
    setIsAiEnabled: (value: boolean) => void
    /** 省略 mode 时按 full 处理：按钮点击即包含 AI 检查 */
    run: (mode?: ProofreadRunMode) => Promise<void>
    abort: () => Promise<void>
    ignore: (issue: ProofreadIssue) => void
    reveal: (issue: ProofreadIssue) => Promise<void>
    /** 按相对偏移直接定位：AI 特征检测的可疑段落复用同一通道 */
    revealRange: (start: number, end: number) => Promise<void>
    applyOne: (issue: ProofreadIssue) => Promise<void>
    applyFixable: () => Promise<void>
}

/** 合并本地与 AI 结果：区间重叠时保留本地，避免同一位置出现两条口径 */
function mergeIssues(local: readonly ProofreadIssue[], ai: readonly ProofreadIssue[]): readonly ProofreadIssue[] {
    const merged: ProofreadIssue[] = [...local]
    for (const issue of ai) {
        const hasOverlap = local.some((exist) => exist.start < issue.end && issue.start < exist.end)
        if (!hasOverlap) {
            merged.push(issue)
        }
    }
    return merged.sort((left, right) => left.start - right.start)
}

/** 把条目换算成写回请求条目：仅保留带确定性替换的项 */
function toEdits(
    issues: readonly ProofreadIssue[],
): { start: number; end: number; quote: string; replacement: string }[] {
    return issues
        .filter((issue) => issue.replacement !== null)
        .map((issue) => ({
            start: issue.start,
            end: issue.end,
            quote: issue.quote,
            replacement: issue.replacement ?? '',
        }))
}

export function useProofreadRun(): ProofreadRunState {
    const [status, setStatus] = useState<ProofreadStatus>('loading')
    const [target, setTarget] = useState<ProofreadTarget | null>(null)
    const [localIssues, setLocalIssues] = useState<readonly ProofreadIssue[]>([])
    const [aiIssues, setAiIssues] = useState<readonly ProofreadIssue[]>([])
    const [ignoredIds, setIgnoredIds] = useState<ReadonlySet<string>>(new Set())
    const [aiStage, setAiStage] = useState<ProofreadAiStage>('idle')
    const [aiProgress, setAiProgress] = useState<ProofreadProgress | null>(null)
    const [aiError, setAiError] = useState<string | null>(null)
    const [failedBatches, setFailedBatches] = useState(0)
    const [skippedBatches, setSkippedBatches] = useState(0)
    const [suppressed, setSuppressed] = useState(0)
    const [elapsedMs, setElapsedMs] = useState(0)
    const [errorText, setErrorText] = useState<string | null>(null)
    const [shouldUseSelection, setShouldUseSelection] = useState(false)
    const [isAiEnabled, setIsAiEnabled] = useState(true)
    const [isApplying, setIsApplying] = useState(false)
    const [isAborting, setIsAborting] = useState(false)
    const [hasResult, setHasResult] = useState(false)
    /** 用户主动取消标记：用于把「取消」与「失败」区分开 */
    const abortedRef = useRef(false)

    useEffect(
        () =>
            onState((message) => {
                if (message.channel !== 'proofread' || !isProofreadAiProgress(message.payload)) {
                    return
                }
                setAiProgress({ batch: message.payload.batch, total: message.payload.total })
            }),
        [],
    )

    /** 还原宿主缓存：正文未变时直接展示上次结果，不再请求本地检查 */
    const restoreCache = useCallback((cache: ProofreadCache): void => {
        const cached = cache.target
        setTarget({
            kind: cached.kind,
            path: cached.path,
            title: cached.title,
            text: '',
            wordCount: cached.wordCount,
            offsetBase: cached.offsetBase,
            version: cached.version,
            mtime: cached.mtime,
            truncated: cached.truncated,
        })
        setLocalIssues(cache.local.issues)
        setSuppressed(cache.local.suppressed)
        setElapsedMs(cache.local.elapsedMs)
        setAiIssues(cache.ai?.issues ?? [])
        setAiStage(cache.ai === null ? 'idle' : 'done')
        setFailedBatches(cache.ai?.failedBatches ?? 0)
        setSkippedBatches(cache.ai?.skippedBatches ?? 0)
        setAiProgress(null)
        setAiError(null)
        setErrorText(null)
        setIgnoredIds(new Set())
        setStatus('ready')
        setHasResult(true)
    }, [])

    const run = useCallback(
        async (mode: ProofreadRunMode = 'full'): Promise<void> => {
            abortedRef.current = false
            if (mode === 'local') {
                setHasResult(false)
            }
            setStatus('running')
            setErrorText(null)
            setAiStage('idle')
            setAiProgress(null)
            setAiError(null)
            setAiIssues([])
            setFailedBatches(0)
            setSkippedBatches(0)
            let result: ProofreadRunResult | null
            try {
                result = await request<ProofreadRunResult | null>('proofread/local', {
                    useSelection: shouldUseSelection,
                })
            } catch (cause) {
                setErrorText(toErrorText(cause))
                setStatus('error')
                return
            }
            if (result === null) {
                setTarget(null)
                setLocalIssues([])
                setStatus('empty')
                return
            }
            setTarget(result.target)
            setLocalIssues(result.local.issues)
            setSuppressed(result.local.suppressed)
            setElapsedMs(result.local.elapsedMs)
            setIgnoredIds(new Set())
            setStatus('ready')
            if (mode === 'full') {
                setHasResult(true)
            }
            if (mode === 'local' || !isAiEnabled) {
                return
            }
            setAiStage('running')
            try {
                const aiResult = await request<ProofreadAiResult | null>(
                    'proofread/ai',
                    { useSelection: shouldUseSelection },
                    AI_TIMEOUT_MS,
                )
                if (aiResult === null) {
                    setAiStage('idle')
                    return
                }
                if (aiResult.path !== result.target.path || aiResult.version !== result.target.version) {
                    setAiStage('error')
                    setAiError('正文在检查期间发生变化，AI 结果已丢弃，请重新校对')
                    return
                }
                setAiIssues(aiResult.issues)
                setFailedBatches(aiResult.failedBatches)
                setSkippedBatches(aiResult.skippedBatches)
                setAiStage('done')
                if (aiResult.failedBatches > 0 || aiResult.skippedBatches > 0) {
                    const parts: string[] = []
                    if (aiResult.failedBatches > 0) {
                        parts.push(`失败 ${String(aiResult.failedBatches)} 批`)
                    }
                    if (aiResult.skippedBatches > 0) {
                        parts.push(`超时跳过 ${String(aiResult.skippedBatches)} 批`)
                    }
                    toast.warning(`AI 检查未覆盖全部批次（${parts.join('，')}），结果可能不完整`)
                }
            } catch (cause) {
                if (abortedRef.current) {
                    setAiStage('idle')
                    return
                }
                setAiStage('error')
                setAiError(toErrorText(cause))
            } finally {
                setAiProgress(null)
                setIsAborting(false)
            }
        },
        [isAiEnabled, shouldUseSelection],
    )

    /** 挂载时使用的首次运行函数：范围变化走下面的重跑分支，不复用这里的闭包 */
    const initialRunRef = useRef(run)

    // 挂载：优先还原上次结果，正文已变或没有缓存时才跑本地规则（本地毫秒级、不消耗额度）
    useEffect(() => {
        let isCancelled = false
        const bootstrap = async (): Promise<void> => {
            let cached: ProofreadCache | null = null
            try {
                cached = await request<ProofreadCache | null>('proofread/cache')
            } catch (cause) {
                if (!isCancelled) {
                    toastError(cause)
                }
            }
            if (isCancelled) {
                return
            }
            if (cached !== null) {
                restoreCache(cached)
                return
            }
            await initialRunRef.current('local')
        }
        void bootstrap()
        return (): void => {
            isCancelled = true
        }
    }, [restoreCache])

    // 检查范围与 AI 开关变化：旧结果与新范围不再对应，按新范围重跑本地（AI 仍需手动触发）
    const scopeRef = useRef({ isAiEnabled, shouldUseSelection })
    useEffect(() => {
        const previous = scopeRef.current
        if (previous.isAiEnabled === isAiEnabled && previous.shouldUseSelection === shouldUseSelection) {
            return
        }
        scopeRef.current = { isAiEnabled, shouldUseSelection }
        void run('local')
    }, [isAiEnabled, run, shouldUseSelection])

    const abort = useCallback(async (): Promise<void> => {
        abortedRef.current = true
        setIsAborting(true)
        try {
            const result = await request<ProofreadAbortResult>('proofread/ai/abort', undefined, ABORT_TIMEOUT_MS)
            // 没有进行中的检查时立即复位；有的话等 run 的 AI 阶段收尾统一复位，
            // 期间按钮保持加载态，避免连点取消或误以为没生效
            if (!result.aborted) {
                setIsAborting(false)
            }
        } catch (cause) {
            setIsAborting(false)
            toastError(cause)
        }
    }, [])

    const visibleIssues = useMemo(
        () => mergeIssues(localIssues, aiIssues).filter((issue) => !ignoredIds.has(issue.id)),
        [aiIssues, ignoredIds, localIssues],
    )

    const fixableCount = useMemo(
        () => visibleIssues.filter((issue) => issue.replacement !== null).length,
        [visibleIssues],
    )

    const ignore = useCallback((issue: ProofreadIssue): void => {
        setIgnoredIds((previous) => {
            const next = new Set(previous)
            next.add(issue.id)
            return next
        })
    }, [])

    const revealRange = useCallback(
        async (start: number, end: number): Promise<void> => {
            if (target === null) {
                return
            }
            try {
                await request('proofread/reveal', {
                    path: target.path,
                    documentStart: target.offsetBase + start,
                    documentEnd: target.offsetBase + end,
                })
            } catch (cause) {
                toastError(cause)
            }
        },
        [target],
    )

    const reveal = useCallback(
        async (issue: ProofreadIssue): Promise<void> => {
            await revealRange(issue.start, issue.end)
        },
        [revealRange],
    )

    const applyIssues = useCallback(
        async (selected: readonly ProofreadIssue[]): Promise<void> => {
            if (target === null) {
                return
            }
            const edits = toEdits(selected)
            if (edits.length === 0) {
                toast.info('没有可自动修复的条目')
                return
            }
            setIsApplying(true)
            try {
                const result = await request<ProofreadApplyResult>('proofread/apply', {
                    path: target.path,
                    offsetBase: target.offsetBase,
                    edits,
                })
                if (result.applied === 0) {
                    toast.warning('没有可应用的修改：文档可能已改动，请重新校对')
                    return
                }
                toast.success(
                    result.skipped > 0
                        ? `已修复 ${String(result.applied)} 处，跳过 ${String(result.skipped)} 处`
                        : `已修复 ${String(result.applied)} 处`,
                )
                // 写回只重跑本地规则：AI 结果已随正文变化失效，是否再消耗额度交给用户点「开始校对」决定
                await run('local')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsApplying(false)
            }
        },
        [run, target],
    )

    const applyOne = useCallback(
        async (issue: ProofreadIssue): Promise<void> => {
            await applyIssues([issue])
        },
        [applyIssues],
    )

    const applyFixable = useCallback(async (): Promise<void> => {
        await applyIssues(visibleIssues)
    }, [applyIssues, visibleIssues])

    return {
        status,
        target,
        visibleIssues,
        aiStage,
        aiProgress,
        aiIssueCount: aiIssues.length,
        failedBatches,
        skippedBatches,
        aiError,
        suppressed,
        elapsedMs,
        errorText,
        shouldUseSelection,
        isAiEnabled,
        isApplying,
        isAborting,
        hasResult,
        isRunning: status === 'running' || aiStage === 'running',
        fixableCount,
        setShouldUseSelection,
        setIsAiEnabled,
        run,
        abort,
        ignore,
        reveal,
        revealRange,
        applyOne,
        applyFixable,
    }
}
