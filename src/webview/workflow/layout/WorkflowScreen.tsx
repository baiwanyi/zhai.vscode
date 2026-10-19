/**
 * 工作流屏幕：把宿主的场景事实解析为唯一的工作流页面并渲染，是模块类型与页面之间的唯一切换点。
 * 复用 hooks/useWorkflowRouting 取得路由事实与动作，core/registry 提供页面注册表，本层只做页面替换。
 * 关键约束：换页只替换渲染的 Page 组件，宿主侧会话（AiChatService）不随换页销毁；
 * 路由事实未就绪时渲染骨架，避免未选定模块时先闪出对话页；模块选定入口仅由初始页与仪表盘提供，页内不叠加切换浮层。
 */
import { Skeleton } from '@components/ui/skeleton'
import type { JSX } from 'react'
import { WORKFLOWS } from '../core/registry'
import { useWorkflowRouting } from '../hooks/useWorkflowRouting'

export function WorkflowScreen(): JSX.Element {
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
        <div className="h-screen">
            <Page context={context} onOpenModule={openModule} onResetModule={resetModule} onOverride={setOverride} />
        </div>
    )
}
