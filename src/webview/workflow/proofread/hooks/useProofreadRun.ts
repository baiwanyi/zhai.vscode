/**
 * 校对运行：先跑本地规则（毫秒级、可离线），再串行跑 AI 语义检查，维护忽略集合并提供定位与应用。
 * 复用约定：请求走 @shared/utils/bridge（方法名受 HostMethodName 约束），AI 进度经 state 的 proofread 通道回流；
 * 错误经 sonner 提示，目标就绪与否由宿主返回 null 表达，前端据此展示引导空态而不是报错。
 * 关键约束：始终检查整篇正文，不提供选区模式；每次检查都由宿主重新读编辑器正文，前端不缓存文本；
 * AI 结果带回文档版本号，与本地结果版本不一致时整批丢弃，避免把旧偏移标到新正文上；
 * AI 条目与本地重叠时保留本地；进入页面先取宿主缓存（正文未变即直接还原上次结果），没有缓存才跑本地规则；
 * 切换 AI 开关与写回后只重跑本地，AI 语义检查只由「开始校对」显式触发且进行中不可取消；
 * 还原后的 target 不含正文，仅用于展示与偏移换算，写回与定位仍由宿主回查文档。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isProofreadAiProgress } from '@shared/types/proofread'
import type {
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
    isAiEnabled: boolean
    isApplying: boolean
    /** 本地或 AI 任一阶段进行中 */
    isRunning: boolean
    /** 已有可用结果（还原自缓存或已跑过完整校对）：按钮据此显示「重新校对」 */
    hasResult: boolean
    /** 可一键写回的条目数 */
    fixableCount: number
    setIsAiEnabled: (value: boolean) => void
    /** 省略 mode 时按 full 处理：按钮点击即包含 AI 检查 */
    run: (mode?: ProofreadRunMode) => Promise<void>
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
    const [isAiEnabled, setIsAiEnabled] = useState(true)
    const [isApplying, setIsApplying] = useState(false)
    const [hasResult, setHasResult] = useState(false)
    /** 当前结果所属文档：路径变化才丢弃忽略集合 */
    const targetPathRef = useRef<string | null>(null)

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
        targetPathRef.current = cached.path
        setStatus('ready')
        setHasResult(true)
    }, [])

    /** 最新 AI 开关状态：AI 请求回来的结果要按当前开关判断，不能只看发起时的快照 */
    const aiEnabledRef = useRef(isAiEnabled)

    const run = useCallback(
        async (mode: ProofreadRunMode = 'full'): Promise<void> => {
            if (mode === 'local') {
                setHasResult(false)
            }
            // 刷新期间保留旧结果，等新结果返回后整体替换：先清空会让列表塌陷再长回来，页面会明显跳动
            setStatus('running')
            setErrorText(null)
            let result: ProofreadRunResult | null
            try {
                // 校对始终针对整篇正文，不再有选区模式
                result = await request<ProofreadRunResult | null>('proofread/local', {
                    useSelection: false,
                })
            } catch (cause) {
                setErrorText(toErrorText(cause))
                setStatus('error')
                return
            }
            if (result === null) {
                setTarget(null)
                setLocalIssues([])
                setAiIssues([])
                setAiStage('idle')
                setStatus('empty')
                return
            }
            // 换了一份文档才丢弃忽略集合：同一份正文重跑时保留，避免忽略过的条目突然回到列表
            if (targetPathRef.current !== result.target.path) {
                setIgnoredIds(new Set())
                targetPathRef.current = result.target.path
            }
            setTarget(result.target)
            setLocalIssues(result.local.issues)
            setSuppressed(result.local.suppressed)
            setElapsedMs(result.local.elapsedMs)
            setStatus('ready')
            if (mode === 'full') {
                setHasResult(true)
            }
            if (mode === 'local' || !isAiEnabled) {
                return
            }
            setAiProgress(null)
            setAiStage('running')
            try {
                const aiResult = await request<ProofreadAiResult | null>(
                    'proofread/ai',
                    { useSelection: false },
                    AI_TIMEOUT_MS,
                )
                if (aiResult === null) {
                    // 没有结果就没有可展示的 AI 条目，旧结果不能继续挂在「未执行」下面
                    setAiIssues([])
                    setAiStage('idle')
                    return
                }
                if (aiResult.path !== result.target.path || aiResult.version !== result.target.version) {
                    setAiIssues([])
                    setFailedBatches(0)
                    setSkippedBatches(0)
                    setAiStage('error')
                    setAiError('正文在检查期间发生变化，AI 结果已丢弃，请重新校对')
                    return
                }
                // 检查途中被关掉 AI 开关：结果不再展示，按「未执行」收尾
                if (!aiEnabledRef.current) {
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
                // 失败时不保留旧 AI 条目：徽标已显示「检查失败」，再挂着旧条目会让人误以为本次结论
                setAiIssues([])
                setFailedBatches(0)
                setSkippedBatches(0)
                setAiStage('error')
                setAiError(toErrorText(cause))
            } finally {
                setAiProgress(null)
            }
        },
        [isAiEnabled],
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

    // AI 开关变化：本地结果与开关无关，只重置 AI 阶段，避免整页重跑引起列表重建与跳动
    useEffect(() => {
        if (aiEnabledRef.current === isAiEnabled) {
            return
        }
        aiEnabledRef.current = isAiEnabled
        setAiIssues([])
        setAiProgress(null)
        setAiError(null)
        setFailedBatches(0)
        setSkippedBatches(0)
        setAiStage('idle')
    }, [isAiEnabled])

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
                // 写回改变了正文偏移：忽略集合与 AI 结果都随之失效，清掉后只重跑本地规则；
                // 是否再消耗额度跑 AI 交给用户点「开始校对」决定
                setIgnoredIds(new Set())
                setAiIssues([])
                setAiStage('idle')
                setFailedBatches(0)
                setSkippedBatches(0)
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
        isAiEnabled,
        isApplying,
        hasResult,
        isRunning: status === 'running' || aiStage === 'running',
        fixableCount,
        setIsAiEnabled,
        run,
        ignore,
        reveal,
        revealRange,
        applyOne,
        applyFixable,
    }
}
