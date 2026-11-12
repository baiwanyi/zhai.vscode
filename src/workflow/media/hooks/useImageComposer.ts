/**
 * 生图会话状态机：持有正文、增强态与出图请求，处理发送、取消、超时与迟到回包。
 * 复用约定：请求经 @shared/utils/bridge，失败统一 toastError，芯片集合由 usePromptChips 持有并经回调同步；
 * 提示词拼装由调用方注入 composePrompt，上下文、词条、规则与参考图分别由 composeContexts /
 * composePromptTags / composePromptRules / composeReferenceImages 注入——上下文与词条文本、规则标识、
 * 参考图路径都不拼进正文，随请求的 contexts / promptRules / referenceImages 提交；
 * 增强提交的源文本由 composeEnhanceSource 注入、词条标识取 composePromptTags，本 hook 只提供提交瞬间的正文与芯片快照。
 * 对外回调统一用 on 前缀且 Promise 在 hook 内收口（异步实现拆成 runXxx），调用方可直接交给按钮属性。
 * 关键约束：generationRef 是请求代号，取消或重发即自增，旧回包按代号丢弃并只经 onLateGenerated 静默补图；
 * 正文、上下文、词条、规则与参考图都为空才拒绝发送，角色芯片不参与可发送判定；
 * 发送即清空正文与芯片，失败或取消仅在用户没有新输入时回填；生成态经 onGeneratingChange 上报，卸载补发一次结束；
 * 出图是宿主单例任务，切分区 / 切作品只卸载本页：挂载时按作用域对账在途快照、恢复骨架与取消入口，
 * 接管态靠轮询收尾，命中宿主留存的回执就补做封面认领、否则只静默补图；回执按图片 id 去重，
 * 取消与失败兜底一律带作用域，避免误杀别的作品；
 * 增强会把词条原文并进改写结果，成功后经 onConsumePromptChips 摘掉词条芯片，还原时再随快照一起还回去，
 * 否则回填后直接发送会让同一批词条被宿主二次合并；
 * enhancedFrom 取发送前的闭包旧值，不受本次 setState 影响。
 */
import { useEffect, useRef, useState } from 'react'
import type {
    ImageGenerateCompleted,
    ImageGenerateKind,
    ImageGenerateResult,
    ImageGenerateStage,
    ImageGenerateState,
    ImageRatio,
} from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { onState, request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { PromptChip } from './usePromptChips'

/** 出图兜底超时：宿主内置 10 分钟上限，前端放宽到 15 分钟，避免前端先于宿主判超时 */
const GENERATE_TIMEOUT_MS = 900_000

/** 接管态轮询间隔：切走再回来时原请求的回执已丢失，靠周期查询拿终态 */
const GENERATE_POLL_MS = 3_000

/** 回执可认领窗口：重进页面时只补做短时间内完成的出图，更早的旧回执不该再触发封面认领 */
const GENERATE_RESULT_TTL_MS = 600_000

/** 已处理回执的登记上限：满了整体清空，过期窗口已经挡住旧回执，不会重复认领 */
const CONSUMED_RESULT_LIMIT = 50

/** 增强兜底超时：宿主 30 秒上限，前端留一倍余量 */
const ENHANCE_TIMEOUT_MS = 60_000

interface ImageComposerPromptSource {
    text: string
    chips: readonly PromptChip[]
}

/** 草稿：已发出但还没有结果的正文、芯片与增强前原文 */
interface ImageComposerDraft {
    text: string
    chips: readonly PromptChip[]
    enhancedFrom: string | null
}

interface UseImageComposerOptions {
    /** 作品目录：通用文档下为 null，出图落为通用素材 */
    dirPath: string | null
    /** 拼装提示词：传入发送瞬间的正文与芯片快照，避免回填竞态 */
    composePrompt: (source: ImageComposerPromptSource) => string
    /** 收集上下文段：发送时作为 contexts 提交，缺省视为没有上下文 */
    composeContexts?: (chips: readonly PromptChip[]) => string[]
    /** 收集词条标识：发送时一并交给宿主换取词条文本，缺省视为没有词条 */
    composePromptTags?: (chips: readonly PromptChip[]) => string[]
    /** 收集规则标识：发送时交给宿主读盘并入，缺省视为没有规则 */
    composePromptRules?: (chips: readonly PromptChip[]) => string[]
    /** 收集参考图路径：发送时交给宿主读取为多模态输入，缺省视为没有参考图 */
    composeReferenceImages?: (chips: readonly PromptChip[]) => string[]
    /** 拼装待增强的正文：把角色段等参考信息并进去，缺省时原样提交 */
    composeEnhanceSource?: (text: string) => string
    /** 增强成功后回收已并入正文的词条芯片：改写结果里已含词条描述，留着会被二次合并 */
    onConsumePromptChips?: () => void
    /** 生成目标：普通图 / 角色图由调用方按当前模式判定；characterName 是写出处的名称快照 */
    target: { kind: ImageGenerateKind; characterId: string | null; characterName: string | null }
    ratio: ImageRatio
    style: PortraitStyle
    /** 当前芯片快照：发送时存草稿，清空与回填交调用方执行 */
    chips: readonly PromptChip[]
    onClearChips: () => void
    onRestoreChips: (snapshot: readonly PromptChip[]) => void
    onGenerated: (result: ImageGenerateResult) => void
    /** 迟到落盘的回调：请求已取消或被取代但宿主仍出了图，页面只静默刷新列表 */
    onLateGenerated: () => void
    /** 生成中状态上报：页面据此在列表首位挂骨架占位 */
    onGeneratingChange?: (isGenerating: boolean) => void
}

interface UseImageComposerResult {
    text: string
    setText: (text: string) => void
    isGenerating: boolean
    /** 出图阶段：thinking 准备中、generating 已开始出图；未在出图时为 null */
    stage: ImageGenerateStage | null
    isEnhancing: boolean
    /** 增强前原文：非空即处于增强态，可还原 */
    enhancedFrom: string | null
    /** 增强提示词：Promise 在 hook 内收口，对外是同步回调 */
    onEnhance: () => void
    onRestore: () => void
    /** 发送：Promise 在 hook 内收口，可直接交给按钮的 onSend */
    onSend: () => void
    /** 取消生成：Promise 在 hook 内收口，可直接交给按钮的 onAbort */
    onAbort: () => void
}

export function useImageComposer({
    dirPath,
    composePrompt,
    composeContexts = (): string[] => [],
    composePromptTags = (): string[] => [],
    composePromptRules = (): string[] => [],
    composeReferenceImages = (): string[] => [],
    composeEnhanceSource = (source: string): string => source,
    onConsumePromptChips,
    target,
    ratio,
    style,
    chips,
    onClearChips,
    onRestoreChips,
    onGenerated,
    onLateGenerated,
    onGeneratingChange,
}: UseImageComposerOptions): UseImageComposerResult {
    const [text, setText] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [stage, setStage] = useState<ImageGenerateStage | null>(null)
    const [isEnhancing, setIsEnhancing] = useState(false)
    const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null)

    /** 出图请求代号：取消或重新发送时自增，旧请求迟到的回包按代号丢弃 */
    const generationRef = useRef(0)
    /** 正文最新值：回填草稿时要判断用户是否已在等待期间重新输入，事件回调里捕获的 text 可能滞后 */
    const textRef = useRef(text)
    /** 已发出但还没有结果的草稿：失败或取消时再还回去 */
    const lastDraftRef = useRef<ImageComposerDraft | null>(null)
    /** 增强前的芯片快照：增强会把词条写进正文，还原时要连词条芯片一起还回去 */
    const enhancedChipsRef = useRef<readonly PromptChip[] | null>(null)
    /** 当前生成态是否由对账接管：接管态没有本地回执，收尾只能靠轮询宿主 */
    const adoptedRef = useRef(false)
    /** 接管时宿主留存的回执 id：收尾时据此判断本轮是否真的产出了新图，避免把上一张认领成本轮结果 */
    const adoptedBaselineRef = useRef<string | null>(null)
    /** 迟到落盘回调：定时器里取最新引用，避免父组件每次渲染的新函数把轮询重启一遍 */
    const lateGeneratedRef = useRef(onLateGenerated)
    /** 出图成功回调：接管态收尾要补做封面认领与列表回填，同样只取最新引用 */
    const generatedRef = useRef(onGenerated)

    useEffect(() => {
        textRef.current = text
    }, [text])

    useEffect(() => {
        lateGeneratedRef.current = onLateGenerated
    }, [onLateGenerated])

    useEffect(() => {
        generatedRef.current = onGenerated
    }, [onGenerated])

    /**
     * 与宿主对账：切分区 / 切作品只会卸载本页，出图请求仍在宿主继续跑。
     * 两种结果都要接：仍在生成时恢复骨架与取消入口；切页期间就已完成的那张，凭宿主留存的回执
     * 补做封面认领与列表回填——否则角色卡封面会一直停在没有封面的状态。
     * 作用域一致才认领；别的作品在出图时不展示本页进度，发送会被单任务锁拒绝，但把别人的进度
     * 画在自己页面上只会让人误会。
     */
    useEffect(() => {
        let cancelled = false
        void request<ImageGenerateState>('pressAi/generateImage/state')
            .then((state) => {
                // 本页已经发起过请求时生成态由自己管理，不再接管（对账回包可能晚于发送）
                if (cancelled || generationRef.current !== 0) {
                    return
                }
                if (state.generating !== true) {
                    const completed = takeCompleted(state, dirPath)
                    if (completed !== null) {
                        generatedRef.current(completed)
                    }
                    return
                }
                if (state.dirPath !== dirPath) {
                    return
                }
                adoptedRef.current = true
                adoptedBaselineRef.current = state.lastResult?.result.image.id ?? null
                setIsGenerating(true)
                // 还没有收到任何进度时按「准备中」展示，与发送首帧同口径
                setStage(state.stage === 'generating' ? 'generating' : 'thinking')
            })
            .catch(() => {
                // 对账失败只丢恢复态：界面按未生成处理，重复发送由宿主锁兜底
            })
        return (): void => {
            cancelled = true
        }
    }, [dirPath])

    /**
     * 接管态收尾：原请求的回执随卸载丢失，靠周期查询拿到终态。
     * 宿主留存的回执能认领时按成功处理（补做封面认领与列表回填），否则只静默刷新列表。
     * 只轮询接管来的请求 —— 本页发起的请求有自己的回执，不必额外查询。
     */
    useEffect(() => {
        if (!isGenerating || !adoptedRef.current) {
            return
        }
        const timer = setInterval(() => {
            void request<ImageGenerateState>('pressAi/generateImage/state')
                .then((state) => {
                    if (state.generating) {
                        setStage(state.stage === 'generating' ? 'generating' : 'thinking')
                        return
                    }
                    // 回执还是接管时那一张，说明本轮没产出（失败或取消）：不认领，只补列表
                    const isNewResult =
                        state.lastResult !== null && state.lastResult.result.image.id !== adoptedBaselineRef.current
                    const completed = isNewResult ? takeCompleted(state, dirPath) : null
                    adoptedRef.current = false
                    adoptedBaselineRef.current = null
                    setIsGenerating(false)
                    setStage(null)
                    if (completed !== null) {
                        generatedRef.current(completed)
                        return
                    }
                    lateGeneratedRef.current()
                })
                .catch(() => undefined)
        }, GENERATE_POLL_MS)
        return (): void => {
            clearInterval(timer)
        }
    }, [dirPath, isGenerating])

    /** 上报生成态：成功、失败、取消、超时都会经过 setIsGenerating，页面据此挂载/回收列表骨架 */
    useEffect(() => {
        onGeneratingChange?.(isGenerating)
    }, [isGenerating, onGeneratingChange])

    /**
     * 出图阶段是旁路广播：只更新按钮文案，丢失不影响结果。
     * 关键约束：出图有宿主侧单任务锁，同一时刻只有一个请求，故不必按请求 id 区分来源。
     */
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'imagegen') {
                return
            }
            const payload = message.payload
            if (typeof payload !== 'object' || payload === null) {
                return
            }
            const next = (payload as { stage?: unknown }).stage
            if (next === 'thinking' || next === 'generating') {
                setStage(next)
            }
        })
    }, [])

    /** 卸载（切换作品或参数重载）时补发一次结束，否则页面会停在「生成中」的骨架上 */
    useEffect(() => {
        return (): void => {
            onGeneratingChange?.(false)
        }
    }, [onGeneratingChange])

    /** 把草稿还给用户：只在没有新输入时回填，不覆盖等待期间重新写下的内容 */
    const restoreDraft = (): void => {
        const draft = lastDraftRef.current
        lastDraftRef.current = null
        if (draft === null) {
            return
        }
        const isEmpty = textRef.current.trim().length === 0
        setText((current) => (current.trim().length > 0 ? current : draft.text))
        onRestoreChips(draft.chips)
        // 增强态跟着正文走：用户已经重新写过内容时不恢复，否则按钮会对一段新文字喊「还原」
        if (isEmpty) {
            setEnhancedFrom(draft.enhancedFrom)
        }
    }

    /**
     * 增强提示词：提交的是「拼好的增强源」（正文 + 角色段），让改写结果带上角色长相与身份。
     * 关键约束：enhancedFrom 只记纯正文——还原时回到用户自己写的内容，不把参考段留在输入框里。
     */
    const runEnhance = async (): Promise<void> => {
        const original = text.trim()
        if (original.length === 0) {
            return
        }
        setIsEnhancing(true)
        try {
            const result = await request<{ text: string }>(
                'pressAi/enhanceImagePrompt',
                // 词条只传标识：宿主按标识读盘后与正文合并，与出图共用同一份合并口径
                {
                    dirPath: dirPath ?? undefined,
                    text: composeEnhanceSource(original).trim(),
                    promptTags: composePromptTags(chips),
                },
                ENHANCE_TIMEOUT_MS,
            )
            setEnhancedFrom(original)
            setText(result.text)
            // 词条描述已随改写结果进入正文：先记快照再摘芯片，避免回填后发送时二次合并
            enhancedChipsRef.current = chips
            onConsumePromptChips?.()
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsEnhancing(false)
        }
    }

    /** 增强提示词：对外只给同步回调，避免 Promise 泄漏到按钮的 onEnhance */
    const onEnhance = (): void => {
        void runEnhance()
    }

    /** 还原增强前原文：同步动作，直接暴露给按钮 */
    const onRestore = (): void => {
        if (enhancedFrom === null) {
            return
        }
        setText(enhancedFrom)
        // 词条芯片在增强成功时被摘掉，还原要与正文一起还回去，否则用户拿回原文却丢了词条
        const snapshot = enhancedChipsRef.current
        if (snapshot !== null) {
            onRestoreChips(snapshot)
            enhancedChipsRef.current = null
        }
        setEnhancedFrom(null)
    }

    /**
     * 取消宿主的在途出图：带上本页作用域，宿主只取消归属一致的那一次，
     * 避免切作品后发送撞上单任务锁、把上一次作品的请求误杀。
     */
    const abortGeneration = async (): Promise<void> => {
        try {
            await request('pressAi/generateImage/abort', { dirPath })
        } catch {
            // 取消失败不影响前端复位：下一次发送会由宿主返回「已有生成中」提示
        }
    }

    const runSend = async (): Promise<void> => {
        const prompt = composePrompt({ text, chips })
        /** 上下文段：菜单里添加的内容，作为背景随请求提交，不进正文 */
        const contexts = composeContexts(chips)
        /** 词条标识：正文之外的内容，正文为空时也能出图，故与正文一起判定 */
        const promptTags = composePromptTags(chips)
        /** 规则标识：正文由宿主读盘，只挂规则同样可以出图 */
        const promptRules = composePromptRules(chips)
        /** 参考图路径：由宿主校验并读成多模态输入，只挂参考图同样可以出图 */
        const referenceImages = composeReferenceImages(chips)
        if (
            prompt.length === 0 &&
            contexts.length === 0 &&
            promptTags.length === 0 &&
            promptRules.length === 0 &&
            referenceImages.length === 0
        ) {
            return
        }
        const token = generationRef.current + 1
        generationRef.current = token
        // 本页发起的请求有自己的回执，退出接管态（不再轮询）
        adoptedRef.current = false
        setIsGenerating(true)
        // 首帧先给「准备中」，宿主的 thinking 广播到达后覆盖为同一值，避免等待期间没有文案
        setStage('thinking')
        // 发送即清空：生成期间输入框不该还停着上一轮的提示词，否则看起来像没发出去；
        // 草稿存在 ref 里（含增强前原文），失败或取消时再还回去
        lastDraftRef.current = { text, chips, enhancedFrom }
        setText('')
        onClearChips()
        // 空输入框不是「增强结果」，增强态随发送复位；本次请求仍带上发送前的 enhancedFrom
        setEnhancedFrom(null)
        enhancedChipsRef.current = null
        try {
            const result = await request<ImageGenerateResult>(
                'pressAi/generateImage',
                {
                    dirPath: dirPath ?? undefined,
                    prompt,
                    // 上下文作为独立字段提交，不混进上面的 prompt 正文
                    contexts: contexts.length > 0 ? contexts : undefined,
                    // 词条只传标识，文本由宿主按 prompt 原文换取后并入提示词
                    promptTags: promptTags.length > 0 ? promptTags : undefined,
                    // 规则同样只传标识，正文由宿主按标识读盘后作为约束段并入
                    promptRules: promptRules.length > 0 ? promptRules : undefined,
                    // 参考图只传宿主登记过的路径，由宿主读取字节后作为多模态输入
                    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
                    kind: target.kind,
                    characterId: target.characterId,
                    // 角色名快照：宿主写入媒体出处，角色被删除后仍能显示原归属
                    characterName: target.characterName,
                    ratio,
                    // 画风随请求下发，由宿主并入最终提示词（前端不再另拼，避免画风描述重复）
                    style,
                    enhancedFrom: enhancedFrom ?? undefined,
                },
                GENERATE_TIMEOUT_MS,
            )
            // 已取消或被新请求取代：结果照常落盘，但不写回界面（不认领封面、不清空输入），
            // 只让页面静默刷新列表，免去用户切页才能看到这张图
            if (generationRef.current !== token) {
                onLateGenerated()
                return
            }
            lastDraftRef.current = null
            // 本页已消费这条回执：重进页面时不再重复认领同一张图
            rememberConsumed(result.image.id)
            onGenerated(result)
        } catch (cause) {
            if (generationRef.current !== token) {
                return
            }
            // 超时或失败后宿主可能仍在出图，主动取消以释放并发锁
            void abortGeneration()
            restoreDraft()
            toastError(cause)
        } finally {
            if (generationRef.current === token) {
                setIsGenerating(false)
                setStage(null)
            }
        }
    }

    /** 发送：对外只给同步回调，避免 Promise 泄漏到按钮的 onSend */
    const onSend = (): void => {
        void runSend()
    }

    /** 取消生成：立即复位按钮，不等宿主回包，避免模型慢时界面卡在「生成中」 */
    const runAbort = async (): Promise<void> => {
        generationRef.current += 1
        adoptedRef.current = false
        setIsGenerating(false)
        setStage(null)
        // 主动取消多半是想改两句再重发，草稿直接还回去，省得重打一遍
        restoreDraft()
        await abortGeneration()
    }

    /** 取消：对外只给同步回调，点下即复位，不等宿主的取消回包 */
    const onAbort = (): void => {
        void runAbort()
    }

    return { text, setText, isGenerating, stage, isEnhancing, enhancedFrom, onEnhance, onRestore, onSend, onAbort }
}

/**
 * 已处理过的出图回执：接管态、重新挂载与本页自己的回执都登记在这里，按图片 id 去重，
 * 避免重进页面后对同一张图重复认领封面。模块级保存即可——同一时刻只有一个媒体页在用。
 */
const consumedResultIds = new Set<string>()

/** 登记回执已处理：超出上限整体清空，过期窗口已经挡住旧回执，不会因此重复认领 */
function rememberConsumed(imageId: string): void {
    if (consumedResultIds.size >= CONSUMED_RESULT_LIMIT) {
        consumedResultIds.clear()
    }
    consumedResultIds.add(imageId)
}

/**
 * 取走可认领的回执：归属与当前作用域一致、在有效窗口内、且没处理过才返回，返回值即代表「已消费」。
 * 关键约束：过期判断用宿主给的完成时刻 —— 重进页面时更早的旧回执不该再触发封面认领。
 */
function takeCompleted(state: ImageGenerateState, dirPath: string | null): ImageGenerateResult | null {
    const completed: ImageGenerateCompleted | null = state.lastResult
    if (completed === null || completed.dirPath !== dirPath) {
        return null
    }
    if (Date.now() - completed.finishedAt > GENERATE_RESULT_TTL_MS) {
        return null
    }
    const imageId = completed.result.image.id
    if (consumedResultIds.has(imageId)) {
        return null
    }
    rememberConsumed(imageId)
    return completed.result
}
