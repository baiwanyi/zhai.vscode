/**
 * 写作流程步骤条：以五个圆点串起「新建作品 → 作品设定 → 人物设定 → 大纲 → 章节写作」。
 * 复用约定：步骤清单取自 constants 的 FLOW_STEPS，样式沿用页头的紧凑字号与小圆角，不引入新色值；
 * 当前步骤以外的文字在窄容器下折叠，只保留序号圆点，避免侧栏宽度把标题挤成竖排。
 * 关键约束：当前步骤须声明 aria-current="step"；步骤既可作为进度展示，也允许点击跳转，
 * 因此每一项都必须是可聚焦的按钮，而不是纯装饰元素。
 */
import { cn } from 'cn'
import { Check, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import type { JSX } from 'react'
import { FLOW_STEPS } from '../constants'

interface PressFlowStepsProps {
    /** 当前步骤序号，取值 1-5 */
    current: number
    onSelect: (step: number) => void
}

export function PressFlowSteps({ current, onSelect }: PressFlowStepsProps): JSX.Element {
    return (
        <ol className="flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label="写作流程">
            {FLOW_STEPS.map((step, index) => {
                const isDone = step.id < current
                const isCurrent = step.id === current

                return (
                    <Fragment key={step.id}>
                        {index > 0 ? (
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                        ) : null}
                        <li className="shrink-0">
                            <button
                                type="button"
                                aria-current={isCurrent ? 'step' : undefined}
                                className={cn(
                                    'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                                    isCurrent ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted',
                                )}
                                onClick={() => onSelect(step.id)}
                            >
                                <span
                                    className={cn(
                                        'flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums',
                                        isDone && 'border-transparent bg-primary text-primary-foreground',
                                        isCurrent && !isDone && 'border-primary text-primary',
                                        !isDone && !isCurrent && 'border-border',
                                    )}
                                    aria-hidden="true"
                                >
                                    {isDone ? <Check className="size-2.5" /> : step.id}
                                </span>
                                <span className={cn('truncate', !isCurrent && 'hidden @xs:inline')}>{step.label}</span>
                            </button>
                        </li>
                    </Fragment>
                )
            })}
        </ol>
    )
}
