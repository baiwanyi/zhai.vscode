/**
 * 工作流宿主：把宿主的场景事实解析为唯一的工作流页面并渲染，是模块类型与页面之间的唯一切换点。
 * 复用 hooks/useWorkflowRouting 取得路由事实与用户覆盖，registry 提供页面注册表。
 * 关键约束：换页只替换渲染的组件，宿主侧会话（AiChatService）不随换页销毁；
 * 路由事实未就绪时渲染骨架，避免笔记编辑场景下先闪出对话页。
 */
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkflowRouting } from './hooks/useWorkflowRouting'
import { WORKFLOWS } from './registry'
import type { JSX } from 'react'

export function WorkflowHost(): JSX.Element {
    const { context, workflowId, isReady, setOverride } = useWorkflowRouting()
    const { component: Workflow } = WORKFLOWS[workflowId]

    if (!isReady) {
        return (
            <div className="flex h-screen flex-col gap-3 p-3">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="min-h-0 flex-1" />
            </div>
        )
    }

    return <Workflow context={context} onOverride={setOverride} />
}
