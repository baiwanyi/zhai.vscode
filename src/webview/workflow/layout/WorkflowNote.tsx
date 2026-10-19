/**
 * 笔记工作流页：笔记模块与笔记编辑场景的专属落点，模块切换时由注册表直接渲染本文件。
 * 复用约定：当前先以占位页承接（直接调用同目录的 WorkflowPlaceholder 并透传路由事实与动作），
 * 后续接入笔记专属能力时只改本文件，注册表与路由表无需改动。
 * 关键约束：本页不解析路由、不自行发请求；透传的选定与清除动作由占位页按需触发。
 */
import type { WorkflowContextState, WorkflowId } from '@shared/types/workflow'
import { WorkflowPlaceholder } from './WorkflowPlaceholder'
import type { JSX } from 'react'

interface WorkflowNoteProps {
    context: WorkflowContextState
    onOpenModule: (module: string) => Promise<void>
    onResetModule: () => Promise<void>
    onOverride: (workflowId: WorkflowId) => void
}

export function WorkflowNote({ context, onOpenModule, onResetModule, onOverride }: WorkflowNoteProps): JSX.Element {
    return (
        <WorkflowPlaceholder
            context={context}
            onOpenModule={onOpenModule}
            onResetModule={onResetModule}
            onOverride={onOverride}
        />
    )
}
