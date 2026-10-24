/**
 * 检查项列表：四张检查卡按「单字徽标 + 标题 + 状态徽标」铺开，命中条目在卡内逐条列出。
 * 复用约定：容器取 @components/ui/card 槽位、状态取 Badge、条目交给 ProofreadIssueItem；
 * 元数据与文案全部来自 ../constants，本文件不判断类别语义，只按类别归属区分本地与 AI 的状态口径。
 * 关键约束：AI 类别的失败与未执行必须显式区分，不能显示成「未发现问题」；
 * 自定义纠错卡的「设置词库」入口只在卡片动作区出现，与其它卡的纯状态呈现区分。
 */
import { cn } from 'cn'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Spinner } from '@components/ui/spinner'
import type { ProofreadIssue } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import { ProofreadIssueItem } from './ProofreadIssueItem'
import type { ProofreadCategoryMeta } from '../constants'
import type { ProofreadAiStage, ProofreadProgress, ProofreadStatus } from '../hooks/useProofreadRun'
import type { JSX } from 'react'
import {
    AI_IDLE_HINT,
    AI_OFF_HINT,
    PROOFREAD_AI_CATEGORIES,
    PROOFREAD_CATEGORY_LIST,
    UNAVAILABLE_LABEL,
} from '../constants'

interface ProofreadCheckListProps {
    issues: readonly ProofreadIssue[]
    status: ProofreadStatus
    aiStage: ProofreadAiStage
    aiProgress: ProofreadProgress | null
    aiError: string | null
    /** AI 开关：关闭后 AI 类别只显示「未执行」，与「等待点击开始校对」区分开 */
    isAiEnabled: boolean
    /** 未覆盖的批次数（失败 + 超时跳过）：不为 0 时不得给出「未发现问题」的结论 */
    uncoveredBatches: number
    onApply: (issue: ProofreadIssue) => void
    onReveal: (issue: ProofreadIssue) => void
    onIgnore: (issue: ProofreadIssue) => void
    onOpenLexicon: () => void
}

/** 类别状态：徽标文案、配色与卡内提示 */
interface CategoryState {
    label: string
    className: string
    hint: string
    /** 徽标内展示加载动画：AI 逐批检查期间用动画代替省略号 */
    isBusy?: boolean
}

/** 本地类别的状态 */
function readLocalState(meta: ProofreadCategoryMeta, count: number, status: ProofreadStatus): CategoryState {
    if (status === 'running' || status === 'loading') {
        return { label: '检测中…', className: 'text-muted-foreground', hint: '' }
    }
    if (count > 0) {
        return { label: `发现 ${String(count)} 处`, className: meta.toneClass, hint: '' }
    }
    if (status === 'ready') {
        return { label: '未发现问题', className: 'text-muted-foreground', hint: meta.emptyText }
    }
    return { label: '未检测', className: 'text-muted-foreground', hint: '' }
}

/** AI 类别的状态：区分进行中、失败、未执行与已完成 */
function readAiState(
    meta: ProofreadCategoryMeta,
    count: number,
    status: ProofreadStatus,
    aiStage: ProofreadAiStage,
    aiProgress: ProofreadProgress | null,
    aiError: string | null,
    isAiEnabled: boolean,
    uncoveredBatches: number,
): CategoryState {
    if (aiStage === 'running') {
        return {
            label: aiProgress === null ? 'AI 检查中' : `AI ${String(aiProgress.batch)}/${String(aiProgress.total)}`,
            className: 'text-muted-foreground',
            hint: 'AI 正在逐批检查，可随时取消',
            isBusy: true,
        }
    }
    if (aiStage === 'error') {
        return {
            label: '检查失败',
            className: 'text-destructive',
            hint: aiError ?? 'AI 检查失败，请重新校对',
        }
    }
    if (aiStage === 'idle' && status === 'ready') {
        return {
            label: '未执行',
            className: 'text-muted-foreground',
            hint: isAiEnabled ? AI_IDLE_HINT : AI_OFF_HINT,
        }
    }
    if (aiStage === 'idle') {
        return { label: '等待中', className: 'text-muted-foreground', hint: '' }
    }
    if (count > 0) {
        return { label: `发现 ${String(count)} 处`, className: meta.toneClass, hint: '' }
    }
    // 有批次没跑完就不能给出「未发现问题」的结论，改为提示覆盖不完整
    return {
        label: '未发现问题',
        className: 'text-muted-foreground',
        hint: uncoveredBatches > 0 ? `${String(uncoveredBatches)} 批未完成，结果可能不完整` : meta.emptyText,
    }
}

/** 按类别归属选择状态口径 */
function readCategoryState(
    meta: ProofreadCategoryMeta,
    count: number,
    status: ProofreadStatus,
    aiStage: ProofreadAiStage,
    aiProgress: ProofreadProgress | null,
    aiError: string | null,
    isAiEnabled: boolean,
    uncoveredBatches: number,
): CategoryState {
    if (!meta.available) {
        return { label: UNAVAILABLE_LABEL, className: 'text-muted-foreground', hint: '' }
    }
    if (PROOFREAD_AI_CATEGORIES.includes(meta.id)) {
        return readAiState(meta, count, status, aiStage, aiProgress, aiError, isAiEnabled, uncoveredBatches)
    }
    return readLocalState(meta, count, status)
}

export function ProofreadCheckList({
    issues,
    status,
    aiStage,
    aiProgress,
    aiError,
    isAiEnabled,
    uncoveredBatches,
    onApply,
    onReveal,
    onIgnore,
    onOpenLexicon,
}: ProofreadCheckListProps): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            {PROOFREAD_CATEGORY_LIST.map((meta) => {
                const items = issues.filter((issue) => issue.category === meta.id)
                const state = readCategoryState(
                    meta,
                    items.length,
                    status,
                    aiStage,
                    aiProgress,
                    aiError,
                    isAiEnabled,
                    uncoveredBatches,
                )
                return (
                    <Card key={meta.id} size="sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <span
                                    className={cn(
                                        'flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium',
                                        meta.toneClass,
                                    )}
                                >
                                    {meta.badge}
                                </span>
                                {meta.title}
                            </CardTitle>
                            <CardDescription>{meta.description}</CardDescription>
                            <CardAction className="flex items-center gap-1">
                                <Badge variant="outline" className={state.className}>
                                    {state.isBusy === true ? <Spinner /> : null}
                                    {state.label}
                                </Badge>
                                {meta.id === 'custom' ? (
                                    <Button size="xs" variant="ghost" onClick={onOpenLexicon}>
                                        设置词库
                                    </Button>
                                ) : null}
                            </CardAction>
                        </CardHeader>
                        {items.length > 0 ? (
                            <CardContent className="flex flex-col gap-1.5">
                                {items.map((issue) => (
                                    <ProofreadIssueItem
                                        key={issue.id}
                                        issue={issue}
                                        onApply={onApply}
                                        onReveal={onReveal}
                                        onIgnore={onIgnore}
                                    />
                                ))}
                            </CardContent>
                        ) : null}
                        {items.length === 0 && state.hint.length > 0 ? (
                            <CardContent>
                                <p className="text-xs text-muted-foreground">{state.hint}</p>
                            </CardContent>
                        ) : null}
                    </Card>
                )
            })}
        </div>
    )
}
