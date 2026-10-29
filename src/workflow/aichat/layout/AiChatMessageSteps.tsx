/**
 * 执行过程：把工具调用与子任务渲染为可折叠的步骤时间线，位于思维链与正文之间。
 * 复用 @components/ui/trace 的轨迹行与折叠容器（图标 / 标题 / 耗时 / 状态），不自建折叠头。
 * 关键约束：执行中强制展开、落定后收起为一行 —— 过程是解释性信息，不该长期占据阅读区；
 * 状态只认 status（running / error / pending / 缺省已完成），不根据工具名猜结果；
 * 失败原因必须写进标题文字，状态色不能作为唯一信息来源。
 */
import { Bot, ListChecks, Loader2, PencilLine, Search, Terminal, Wrench } from 'lucide-react'
import { useState } from 'react'
import {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceDescription,
    TraceIcon,
    TraceLine,
    TraceTitle,
} from '@components/ui/trace'
import type { AiStep, AiStepStatus } from '@shared/types/aiChat'
import type { JSX } from 'react'
import { describeStep, formatStepDuration } from '../utils'

interface AiChatMessageStepsProps {
    /** 本条消息已收到的步骤快照，按首次出现顺序排列 */
    steps: AiStep[]
    /** 本轮是否仍在生成：决定标题文案与是否强制展开 */
    isStreaming: boolean
}

/** 步骤状态到轨迹行状态的映射：完成态缺省（组件以无 status 表达已完成） */
function toTraceStatus(status: AiStepStatus): 'running' | 'error' | 'pending' | undefined {
    if (status === 'running' || status === 'error' || status === 'pending') {
        return status
    }
    return undefined
}

/** 步骤图标：按工具名归类，未知工具给通用扳手，任务给机器人 */
function StepIcon({ step }: { step: AiStep }): JSX.Element {
    if (step.kind === 'task') {
        return <Bot />
    }
    if (step.name === 'Read' || step.name === 'Glob' || step.name === 'Grep' || step.name === 'LS') {
        return <Search />
    }
    if (step.name === 'Edit' || step.name === 'Write' || step.name === 'MultiEdit' || step.name === 'NotebookEdit') {
        return <PencilLine />
    }
    if (step.name === 'Bash' || step.name === 'PowerShell') {
        return <Terminal />
    }
    return <Wrench />
}

export function AiChatMessageSteps({ steps, isStreaming }: AiChatMessageStepsProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const errorCount = steps.filter((step) => step.status === 'error').length
    const pendingCount = steps.filter((step) => step.status === 'running' || step.status === 'pending').length
    /** 执行中：仍有未落定的步骤，且本轮尚未结束 */
    const isWorking = isStreaming && pendingCount > 0
    const summaryParts = [`${String(steps.length)} 步`]
    if (errorCount > 0) {
        summaryParts.push(`${String(errorCount)} 步失败`)
    }
    return (
        <Trace className="mb-2">
            <TraceCollapsible open={isWorking || isOpen} onOpenChange={setIsOpen}>
                <TraceCollapsibleTrigger>
                    <TraceLine status={isWorking ? 'running' : errorCount > 0 ? 'error' : undefined}>
                        <TraceIcon>{isWorking ? <Loader2 className="animate-spin" /> : <ListChecks />}</TraceIcon>
                        <TraceTitle>{isWorking ? '正在执行' : '执行过程'}</TraceTitle>
                        <TraceDescription>{summaryParts.join('，')}</TraceDescription>
                    </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent>
                    <Trace>
                        {steps.map((step) => {
                            const duration = formatStepDuration(step.elapsedMs)
                            const title = describeStep(step)
                            return (
                                <TraceLine key={step.id} status={toTraceStatus(step.status)}>
                                    <TraceIcon>
                                        <StepIcon step={step} />
                                    </TraceIcon>
                                    <TraceTitle>
                                        {step.status === 'error' && step.error !== null
                                            ? `${title}（${step.error}）`
                                            : title}
                                    </TraceTitle>
                                    {duration === null ? null : <TraceDescription>{duration}</TraceDescription>}
                                </TraceLine>
                            )
                        })}
                    </Trace>
                </TraceCollapsibleContent>
            </TraceCollapsible>
        </Trace>
    )
}
