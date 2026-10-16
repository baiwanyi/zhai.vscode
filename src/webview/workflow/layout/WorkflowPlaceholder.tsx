/**
 * 工作流占位页：模块尚未接入专属工作流时的统一落点，标题取模块标题以区分是哪个模块在用占位页。
 * 复用 @/components/ui 的 empty / button 组合与 routing 的模块标题表，不自行解析路由。
 * 关键约束：「仍然使用 AI 对话」出口覆盖到写作管理页（当前承接对话能力的模块页），避免用户被挡在对话能力之外；
 * 「返回模块选择」用于清除宿主持久保存的选定，避免选定模块后无法回到初始页。
 */
import { ArrowLeft, MessagesSquare, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { WorkflowContextState, WorkflowId } from '@/shared/types/workflow'
import type { JSX } from 'react'
import { readModuleLabel } from '../core/routing'

/** 对话承接页：占位页的「仍然使用 AI 对话」出口落到该页，其内部组合了 AiChat */
const CHAT_FALLBACK_WORKFLOW: WorkflowId = 'press'

interface WorkflowPlaceholderProps {
    context: WorkflowContextState
    onOpenModule: (module: string) => Promise<void>
    onResetModule: () => Promise<void>
    onOverride: (workflowId: WorkflowId) => void
}

export function WorkflowPlaceholder({ context, onResetModule, onOverride }: WorkflowPlaceholderProps): JSX.Element {
    const [error, setError] = useState<string | null>(null)
    const label = readModuleLabel(context.module)

    const handleReset = async (): Promise<void> => {
        setError(null)
        try {
            await onResetModule()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }

    return (
        <div className="flex h-screen flex-col justify-center p-4">
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                        <Pencil className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>{label}</EmptyTitle>
                    <EmptyDescription>{label}的专属工作流尚未接入，当前以占位页承接。</EmptyDescription>
                    <p className="text-muted-foreground text-xs">模块：{context.module}</p>
                </EmptyHeader>
                <EmptyContent>
                    <Button size="sm" variant="outline" onClick={() => void handleReset()}>
                        <ArrowLeft data-icon="inline-start" />
                        返回模块选择
                    </Button>
                    <Button size="sm" onClick={() => onOverride(CHAT_FALLBACK_WORKFLOW)}>
                        <MessagesSquare data-icon="inline-start" />
                        仍然使用 AI 对话
                    </Button>
                    {error !== null ? <p className="text-destructive text-xs">{error}</p> : null}
                </EmptyContent>
            </Empty>
        </div>
    )
}
