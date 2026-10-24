/**
 * AI 特征检测卡：展示人工 / AI / 疑似 AI 三类占比环形图、结论提示与最值得复核的可疑段落。
 * 复用约定：容器取 @components/ui/card、弹窗取 dialog、条目取 item；环形图单独成文件并按需动态加载，
 * 避免 recharts 进入主包拖慢面板首屏；文案与阈值来自 ../constants，检测流程在 hooks/useProofreadAiDetect。
 * 关键约束：未配置密钥、未同意上传、检测中、失败四种状态各自给出明确出口，不把「未检测」渲染成 0%；
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
import { Spinner } from '@components/ui/spinner'
import type { ProofreadAiDetectResult, ProofreadAiDetectState, ProofreadDetectSegment } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import type { ProofreadDetectStage } from '../hooks/useProofreadAiDetect'
import type { JSX } from 'react'
import {
    DETECT_CONSENT_CANCEL,
    DETECT_CONSENT_CONFIRM,
    DETECT_CONSENT_DESCRIPTION,
    DETECT_CONSENT_TITLE,
    DETECT_CONFIGURE_LABEL,
    DETECT_DESCRIPTION,
    DETECT_DISCLAIMER,
    DETECT_EMPTY_HINT,
    DETECT_LABEL_NAMES,
    DETECT_LOW_HUMAN_THRESHOLD,
    DETECT_RERUN_LABEL,
    DETECT_RUN_LABEL,
    DETECT_RUNNING_LABEL,
    DETECT_TITLE,
} from '../constants'

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

/** 状态徽标：未配置、检测中、失败、完成与待检测分开表达 */
function readStatus(stage: ProofreadDetectStage, state: ProofreadAiDetectState | null): string {
    if (state === null) {
        return '读取中…'
    }
    if (!state.hasKey) {
        return '未配置'
    }
    if (stage === 'running') {
        return '检测中…'
    }
    if (stage === 'error') {
        return '检测失败'
    }
    if (stage === 'done') {
        return '已完成'
    }
    return '待检测'
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
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Gauge className="size-4" />
                    {DETECT_TITLE}
                </CardTitle>
                <CardDescription>{DETECT_DESCRIPTION}</CardDescription>
                <CardAction>
                    <Badge
                        variant="outline"
                        className={stage === 'error' ? 'text-destructive' : 'text-muted-foreground'}
                    >
                        {readStatus(stage, state)}
                    </Badge>
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {!hasKey ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">
                            需要 EdgeOne Makers 的 API Key（控制台 Makers - Models - API Key 创建），密钥仅保存在本机。
                        </p>
                        <Button size="xs" variant="outline" onClick={onConfigureKey}>
                            {DETECT_CONFIGURE_LABEL}
                        </Button>
                    </div>
                ) : null}
                {hasKey && stage === 'running' ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner />
                        {DETECT_RUNNING_LABEL}
                    </div>
                ) : null}
                {hasKey && stage === 'error' && error !== null ? (
                    <>
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                        <Button size="xs" variant="outline" onClick={onDetect}>
                            {DETECT_RUN_LABEL}
                        </Button>
                    </>
                ) : null}
                {hasKey && result !== null && stage === 'done' ? (
                    <div className="flex flex-col gap-3">
                        <Alert
                            className={
                                result.humanRatio < DETECT_LOW_HUMAN_THRESHOLD
                                    ? 'border-amber-500/40 bg-amber-500/10 *:data-[slot=alert-description]:text-amber-700 dark:*:data-[slot=alert-description]:text-amber-300'
                                    : undefined
                            }
                        >
                            <AlertDescription>
                                {result.humanRatio < DETECT_LOW_HUMAN_THRESHOLD
                                    ? '人工创作特征较弱，建议回看表达习惯后再决定是否调整'
                                    : '人工创作特征占比较高，整体更接近人工写作'}
                            </AlertDescription>
                        </Alert>
                        <Suspense
                            fallback={
                                <div className="flex justify-center py-6">
                                    <Spinner />
                                </div>
                            }
                        >
                            <ProofreadDetectChart result={result} />
                        </Suspense>
                        {result.segments.length > 0 ? (
                            <div className="flex flex-col gap-1.5">
                                <p className="text-xs text-muted-foreground">最值得复核的段落</p>
                                {result.segments.map((segment) => (
                                    <Item
                                        key={`${String(segment.start)}-${String(segment.end)}`}
                                        variant="muted"
                                        size="sm"
                                    >
                                        <ItemContent className="min-w-0">
                                            <ItemTitle className="min-w-0 truncate">
                                                {segment.text.length > 0
                                                    ? segment.text
                                                    : DETECT_LABEL_NAMES[segment.label]}
                                            </ItemTitle>
                                            <ItemDescription>
                                                {DETECT_LABEL_NAMES[segment.label]} · 置信度 {toPercent(segment.conf)} ·
                                                第 {segment.paragraph} 段
                                            </ItemDescription>
                                        </ItemContent>
                                        <ItemActions>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                tooltip="在编辑器中定位"
                                                onClick={() => onRevealSegment(segment)}
                                            >
                                                <LocateFixed />
                                                定位
                                            </Button>
                                        </ItemActions>
                                    </Item>
                                ))}
                            </div>
                        ) : null}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>扣减 {result.usedTokens} tokens</span>
                            <Button size="xs" variant="ghost" onClick={onDetect}>
                                {DETECT_RERUN_LABEL}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{DETECT_DISCLAIMER}</p>
                    </div>
                ) : null}
                {hasKey && stage === 'idle' ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">{DETECT_EMPTY_HINT}</p>
                        <Button size="xs" variant="outline" onClick={onDetect}>
                            {DETECT_RUN_LABEL}
                        </Button>
                    </div>
                ) : null}
            </CardContent>
            <Dialog
                open={isConsentOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        onCloseConsent()
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{DETECT_CONSENT_TITLE}</DialogTitle>
                        <DialogDescription>{DETECT_CONSENT_DESCRIPTION}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={onCloseConsent}>
                            {DETECT_CONSENT_CANCEL}
                        </Button>
                        <Button onClick={onAcceptConsent}>{DETECT_CONSENT_CONFIRM}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
