/**
 * AI 特征检测卡：展示人工 / AI / 疑似 AI 三类占比环形图、结论提示与最值得复核的可疑段落。
 * 复用约定：容器取 @components/ui/card、弹窗取 dialog、条目取 item；环形图单独成文件并按需动态加载，
 * 避免 recharts 进入主包拖慢面板首屏；文案与阈值就地声明在本文件，检测流程在 hooks/useProofreadAiDetect。
 * 关键约束：未配置密钥、未同意上传、检测中、失败四种状态各自给出明确出口，不把「未检测」渲染成 0%；
 * 检测进行中徽标内挂加载动画，内容区改用骨架屏占位，避免卡片在等待期间塌成一行文字；
 * 内容区按 stage 单分支渲染（见 renderBody），四种状态互斥，不靠多个并列条件各自落空来保证；
 * 可疑段落只提供定位，不提供任何自动改写；结果页必须展示官方免责语。
 */
import { Gauge, LocateFixed } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { ProofreadAiDetectResult, ProofreadAiDetectState, ProofreadDetectSegment } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import type { ProofreadDetectStage } from '../hooks/useProofreadAiDetect'
import type { JSX } from 'react'

/** 三类占比的展示名：与朱雀 labels_ratio 的 0/1/2 对应 */
const DETECT_LABEL_NAMES: Readonly<Record<0 | 1 | 2, string>> = {
    0: '人工特征',
    1: 'AI 特征',
    2: '疑似 AI',
}

/** 人工占比低于该阈值时提示「人工创作特征较弱」 */
const DETECT_LOW_HUMAN_THRESHOLD = 0.35

/** 低人工占比的结论条：只覆盖边框、底色与描述文字色，箭头与非描述槽位不受影响 */
const LOW_HUMAN_ALERT_CLASS =
    'border-amber-500/40 bg-amber-500/10 *:data-[slot=alert-description]:text-amber-700 dark:*:data-[slot=alert-description]:text-amber-300'

/** 未配置密钥时的引导：说明密钥来源与保存位置 */
const NO_KEY_HINT = '需要 EdgeOne Makers 的 API Key（控制台 Makers - Models - API Key 创建），密钥仅保存在本机。'

/** 待检测时的说明：只承诺检测能力，不预告任何结论 */
const IDLE_HINT = '检测后展示三类内容占比，以及最值得复核的可疑段落'

/** 失败态兜底文案：错误详情由 Hook 透传，为空时才用 */
const ERROR_FALLBACK = '检测失败，请稍后重试'

/** 检测入口文案：失败重试与首次检测共用一个口径 */
const DETECT_ACTION_LABEL = '开始检测'

/** 结论条文案：人工占比达标与否只影响措辞，不给任何改写建议 */
const LOW_HUMAN_HINT = '人工创作特征较弱，建议回看表达习惯后再决定是否调整'
const HIGH_HUMAN_HINT = '人工创作特征占比较高，整体更接近人工写作'

/** 可疑段落列表的标题 */
const SEGMENT_LIST_TITLE = '最值得复核的段落'

/** 环形图按需加载：recharts 只在真正出结果后才进入运行时 */
const ProofreadDetectChart = lazy(() =>
    import('./ProofreadDetectChart').then((module) => ({ default: module.ProofreadDetectChart })),
)

interface ProofreadAiDetectCardProps {
    stage: ProofreadDetectStage
    state: ProofreadAiDetectState | null
    result: ProofreadAiDetectResult | null
    error: string | null
    isConsentOpen: boolean
    onDetect: () => void
    onConfigureKey: () => void
    onCloseConsent: () => void
    onAcceptConsent: () => void
    onRevealSegment: (segment: ProofreadDetectSegment) => void
}

/** 百分比展示：保留两位，与检测报告口径一致 */
function toPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`
}

/** 状态徽标：文案、配色与加载动画随状态切换，未配置、检测中、失败、完成与待检测各自可辨 */
interface DetectStatus {
    label: string
    /** 徽标配色：浅底深字的整组样式，底色与文字色成对给出 */
    className: string
    /** 徽标内展示加载动画：检测期间用动画表达进行中 */
    isBusy?: boolean
}

/** 按阶段取徽标口径；state 未加载完成时先按「读取中」呈现 */
function readStatus(stage: ProofreadDetectStage, state: ProofreadAiDetectState | null): DetectStatus {
    if (state === null) {
        return { label: '读取中…', className: 'bg-muted text-muted-foreground' }
    }
    if (!state.hasKey) {
        return { label: '未配置', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' }
    }
    if (stage === 'running') {
        return { label: '检测中', className: 'bg-primary text-primary-foreground', isBusy: true }
    }
    if (stage === 'error') {
        return { label: '检测失败', className: 'bg-destructive/10 text-destructive' }
    }
    if (stage === 'done') {
        return { label: '已完成', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' }
    }
    return { label: '待检测', className: 'bg-muted text-muted-foreground' }
}

/** 结论条口径：文案与强调样式由同一判断给出 */
interface HumanVerdict {
    hint: string
    /** 只在低人工占比时强调；达标时不覆盖 Alert 的任何样式 */
    className?: string
}

/** 按人工占比取结论条：同一个阈值判断不再在 JSX 里对文案与配色各写一遍 */
function readHumanVerdict(humanRatio: number): HumanVerdict {
    if (humanRatio < DETECT_LOW_HUMAN_THRESHOLD) {
        return { hint: LOW_HUMAN_HINT, className: LOW_HUMAN_ALERT_CLASS }
    }
    return { hint: HIGH_HUMAN_HINT }
}

interface DetectPromptProps {
    hint: string
    actionLabel: string
    onAction: () => void
}

/** 引导态：未配置密钥与待检测同构，都是一行说明 + 主按钮，出口由 actionLabel 表达 */
function DetectPrompt({ hint, actionLabel, onAction }: DetectPromptProps): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{hint}</p>
            <Button onClick={onAction}>{actionLabel}</Button>
        </div>
    )
}

/** 检测中骨架：按结果区真实结构摆放，等待期间卡片高度不塌陷 */
function DetectSkeleton(): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <Skeleton className="h-11 w-full" />
            <div className="flex items-center">
                {/* 左列写死 128px：内部按钮占位用 w-full，列宽若依赖内容会形成百分比循环 */}
                <div className="flex w-2/3 shrink-0 flex-col items-center gap-3">
                    <Skeleton className="size-32 rounded-full" />
                    <Skeleton className="h-8 w-20" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="mt-1 h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
            </div>
        </div>
    )
}

interface DetectSegmentListProps {
    segments: readonly ProofreadDetectSegment[]
    onRevealSegment: (segment: ProofreadDetectSegment) => void
}

/** 可疑段落：只给定位入口，改写由用户自行判断 */
function DetectSegmentList({ segments, onRevealSegment }: DetectSegmentListProps): JSX.Element {
    return (
        <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">{SEGMENT_LIST_TITLE}</p>
            {segments.map((segment) => (
                <Item key={`${String(segment.start)}-${String(segment.end)}`} variant="muted" size="sm">
                    <ItemContent>
                        <ItemTitle>
                            {segment.text.length > 0 ? segment.text : DETECT_LABEL_NAMES[segment.label]}
                        </ItemTitle>
                        <ItemDescription>
                            {DETECT_LABEL_NAMES[segment.label]} · 置信度 {toPercent(segment.conf)} · 第{' '}
                            {segment.paragraph} 段
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions className="shrink-0">
                        <Button
                            size="icon-xs"
                            variant="outline"
                            tooltip="在编辑器中定位"
                            onClick={() => onRevealSegment(segment)}
                        >
                            <LocateFixed />
                        </Button>
                    </ItemActions>
                </Item>
            ))}
        </div>
    )
}

interface DetectResultProps {
    result: ProofreadAiDetectResult
    onDetect: () => void
    onRevealSegment: (segment: ProofreadDetectSegment) => void
}

/** 检测结果：结论条 → 占比图（扣减回执与免责语随图呈现）→ 可疑段落，顺序即阅读顺序 */
function DetectResult({ result, onDetect, onRevealSegment }: DetectResultProps): JSX.Element {
    const verdict = readHumanVerdict(result.humanRatio)
    return (
        <div className="flex flex-col gap-3">
            <Alert className={verdict.className}>
                <AlertDescription>{verdict.hint}</AlertDescription>
            </Alert>

            <Suspense
                fallback={
                    <div className="flex justify-center py-6">
                        <Spinner />
                    </div>
                }
            >
                <ProofreadDetectChart result={result} onDetect={onDetect} />
            </Suspense>

            {result.segments.length > 0 && (
                <DetectSegmentList segments={result.segments} onRevealSegment={onRevealSegment} />
            )}
        </div>
    )
}

export function ProofreadAiDetectCard({
    stage,
    state,
    result,
    error,
    isConsentOpen,
    onDetect,
    onConfigureKey,
    onCloseConsent,
    onAcceptConsent,
    onRevealSegment,
}: ProofreadAiDetectCardProps): JSX.Element {
    const hasKey = state?.hasKey === true
    const status = readStatus(stage, state)

    /** 内容区按状态单分支渲染：无密钥优先于阶段，其余阶段各占一支，兜底即待检测 */
    function renderBody(): JSX.Element {
        if (!hasKey) {
            return <DetectPrompt hint={NO_KEY_HINT} actionLabel="配置密钥" onAction={onConfigureKey} />
        }
        if (stage === 'running') {
            return <DetectSkeleton />
        }
        if (stage === 'error') {
            return (
                <>
                    <Alert variant="destructive">
                        <AlertDescription>{error ?? ERROR_FALLBACK}</AlertDescription>
                    </Alert>
                    <Button onClick={onDetect}>{DETECT_ACTION_LABEL}</Button>
                </>
            )
        }
        if (stage === 'done' && result !== null) {
            return <DetectResult result={result} onDetect={onDetect} onRevealSegment={onRevealSegment} />
        }
        return <DetectPrompt hint={IDLE_HINT} actionLabel={DETECT_ACTION_LABEL} onAction={onDetect} />
    }

    /** 上传同意弹窗只由检测流程打开：这里仅处理关闭，避免关闭动画期间状态来回切换 */
    function handleConsentOpenChange(isOpen: boolean): void {
        if (!isOpen) {
            onCloseConsent()
        }
    }

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Gauge className="size-4" />
                    AI 特征检测
                </CardTitle>
                <CardDescription>由腾讯云朱雀模型判断人工创作与 AI 生成的占比</CardDescription>
                <CardAction>
                    <Badge className={status.className}>
                        {status.label}
                        {status.isBusy === true && <Spinner />}
                    </Badge>
                </CardAction>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-3">{renderBody()}</CardContent>
            <Dialog open={isConsentOpen} onOpenChange={handleConsentOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认将正文上传至第三方</DialogTitle>
                        <DialogDescription>
                            AI 特征检测需要把当前正文发送至腾讯云 EdgeOne
                            朱雀检测服务。正文不会保存在本插件，但会经过第三方服务处理，请确认后再继续。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={onCloseConsent}>
                            取消
                        </Button>
                        <Button onClick={onAcceptConsent}>同意并继续</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
