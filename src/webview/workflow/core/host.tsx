/**
 * 工作流宿主：把宿主的场景事实解析为唯一的工作流页面并渲染，是模块类型与页面之间的唯一切换点。
 * 复用 hooks/useWorkflowRouting 取得路由事实与动作，registry 提供页面注册表，初始页之外叠加切换浮层。
 * 关键约束：换页只替换渲染的 Page 组件，宿主侧会话（AiChatService）不随换页销毁；
 * 路由事实未就绪时渲染骨架，避免未选定模块时先闪出对话页；初始页自带模块入口，故不再叠加切换浮层。
 */
import { Skeleton } from '@/components/ui/skeleton'
import { WORKFLOWS } from './registry'
import { HOME_WORKFLOW } from './routing'
import type { JSX } from 'react'
import { useWorkflowRouting } from '../hooks/useWorkflowRouting'
import { WorkflowSwitcher } from '../layout/WorkflowSwitcher'

export function Host(): JSX.Element {
    const { context, workflowId, isReady, openModule, resetModule, setOverride } = useWorkflowRouting()
    const { component: Page } = WORKFLOWS[workflowId]

    if (!isReady) {
        return (
            <div className="flex h-screen flex-col gap-3 p-3">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="min-h-0 flex-1" />
            </div>
        )
    }

    return (
        <div className="relative h-screen">
            <Page context={context} onOpenModule={openModule} onResetModule={resetModule} onOverride={setOverride} />
            {workflowId === HOME_WORKFLOW ? null : (
                <WorkflowSwitcher context={context} onOpenModule={openModule} onResetModule={resetModule} />
            )}
        </div>
    )
}
