/**
 * 检查项列表：四张检查卡按「单字徽标 + 标题 + 状态徽标」铺开，命中条目在卡内逐条列出。
 * 复用约定：容器取 @components/ui/card 槽位、状态取 Badge、条目交给 ProofreadIssueItem；
 * 类别元数据与状态文案就地声明在本文件，本文件不判断类别语义，只按类别归属区分本地与 AI 的状态口径。
 * 关键约束：AI 类别的失败与未执行必须显式区分，不能显示成「未发现问题」；
 * 进行中的卡片不写字面提示，卡内改放骨架条——批次进度只在右上角徽标表达，避免同一件事说两遍；
 * 自定义纠错卡的「设置词库」入口只在卡片动作区出现，与其它卡的纯状态呈现区分。
 */
import { cn } from 'cn'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { ProofreadCategory, ProofreadIssue } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import { ProofreadIssueItem } from './ProofreadIssueItem'
import type { ProofreadAiStage, ProofreadProgress, ProofreadStatus } from '../hooks/useProofreadRun'
import type { JSX } from 'react'

/** 单类检查的界面元数据 */
interface ProofreadCategoryMeta {
    id: ProofreadCategory
    /** 单字徽标：对齐参考界面的「错 / 病 / 险 / 纠」 */
    badge: string
    title: string
    /** 徽标配色类：浅底深字，明暗主题共用 */
    toneClass: string
    description: string
    /** 该类未发现问题时的文案 */
    emptyText: string
    /** 是否已接入检查能力 */
    available: boolean
}

/** 四类检查元数据：数组顺序即卡片的展示顺序 */
const PROOFREAD_CATEGORY_META: readonly ProofreadCategoryMeta[] = [
    {
        id: 'typo',
        badge: '错',
        title: '错别字',
        toneClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        description: '内置词表与标点规则',
        emptyText: '未发现错别字与标点问题',
        available: true,
    },
    {
        id: 'sentence',
        badge: '病',
        title: '病句',
        toneClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        description: 'AI 语义检查，仅提示不改写',
        emptyText: '未发现明显病句',
        available: true,
    },
    {
        id: 'risk',
        badge: '险',
        title: '风险段落',
        toneClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        description: 'AI 段落级风险提示，请人工确认',
        emptyText: '未发现风险段落',
        available: true,
    },
    {
        id: 'custom',
        badge: '纠',
        title: '自定义纠错',
        toneClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
        description: '按个人词库匹配',
        emptyText: '词库为空或未命中',
        available: true,
    },
]

/** 属于 AI 检查的类别：状态文案与本地规则分开表达 */
const PROOFREAD_AI_CATEGORIES: readonly ProofreadCategory[] = ['sentence', 'risk']

/** 中性状态的徽标配色：读取中、未检测与未发现问题共用一组底色 + 文字色 */
const MUTED_TONE_CLASS = 'bg-muted text-muted-foreground'

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
    /** 徽标配色：浅底深字的整组样式，底色与文字色成对给出 */
    className: string
    hint: string
    /** 徽标内展示加载动画：AI 逐批检查期间用动画代替省略号 */
    isBusy?: boolean
}

/** 本地类别的状态 */
function readLocalState(meta: ProofreadCategoryMeta, count: number, status: ProofreadStatus): CategoryState {
    if (status === 'running' || status === 'loading') {
        return { label: '检测中', className: 'bg-primary text-primary-foreground', hint: '' }
    }
    if (count > 0) {
        return { label: `发现 ${String(count)} 处`, className: meta.toneClass, hint: '' }
    }
    if (status === 'ready') {
        return { label: '未发现问题', className: MUTED_TONE_CLASS, hint: meta.emptyText }
    }
    return { label: '未检测', className: MUTED_TONE_CLASS, hint: '' }
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
            className: 'bg-primary text-primary-foreground',
            hint: '',
            isBusy: true,
        }
    }
    if (aiStage === 'error') {
        return {
            label: '检查失败',
            className: 'bg-destructive/10 text-destructive',
            hint: aiError ?? 'AI 检查失败，请重新校对',
        }
    }
    if (aiStage === 'idle' && status === 'ready') {
        return {
            label: '未执行',
            className: MUTED_TONE_CLASS,
            hint: isAiEnabled ? '点击「开始校对」后才会执行 AI 语义检查' : '已关闭 AI 检查，仅展示本地规则结果',
        }
    }
    if (aiStage === 'idle') {
        return { label: '等待中', className: MUTED_TONE_CLASS, hint: '' }
    }
    if (count > 0) {
        return { label: `发现 ${String(count)} 处`, className: meta.toneClass, hint: '' }
    }
    // 有批次没跑完就不能给出「未发现问题」的结论，改为提示覆盖不完整
    return {
        label: '未发现问题',
        className: MUTED_TONE_CLASS,
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
        return { label: '未接入', className: MUTED_TONE_CLASS, hint: '' }
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
            {PROOFREAD_CATEGORY_META.map((meta) => {
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
                                <Badge className={state.className}>
                                    {state.label}
                                    {state.isBusy === true && <Spinner />}
                                </Badge>
                                {meta.id === 'custom' && (
                                    <Button size="sm" variant="outline" onClick={onOpenLexicon}>
                                        设置词库
                                    </Button>
                                )}
                            </CardAction>
                        </CardHeader>
                        {items.length > 0 ? (
                            <CardContent className="flex flex-col flex-1 gap-1.5">
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
                        {/* 无条目时始终占位：提示文案一行与两行不应改变卡片高度，否则四张卡片叠加会带动整页跳动；
                            进行中改放骨架条，进度已由徽标表达，卡内不再重复说明 */}
                        {items.length === 0 ? (
                            <CardContent>
                                {state.isBusy === true ? (
                                    <Skeleton className="h-8 w-full" />
                                ) : (
                                    <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{state.hint}</p>
                                )}
                            </CardContent>
                        ) : null}
                    </Card>
                )
            })}
        </div>
    )
}
