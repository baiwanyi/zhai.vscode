/**
 * 工作流页面注册表：把工作流标识映射到具体页面组件，是路由结果唯一的渲染落点。
 * 复用约定：路由规则见 ./routing，组件只接收路由事实与动作回调，自身不发起路由请求。
 * 关键约束：新增工作流须同时登记此处与 ./routing 的映射表，否则解析结果无法渲染。
 */
import type { WorkflowContextState, WorkflowId } from '@/shared/types/workflow'
import { AiChat } from './aichat'
import { WorkflowHome } from './layout/WorkflowHome'
import { WorkflowPlaceholder } from './layout/WorkflowPlaceholder'
import type { JSX } from 'react'

/** 工作流组件入参：路由事实由宿主下发，动作回调经宿主层落库并广播 */
export interface WorkflowRenderProps {
    context: WorkflowContextState
    /** 选定模块：由宿主持久保存并广播新事实 */
    onOpenModule: (module: string) => Promise<void>
    /** 清除模块选择：回到初始页 */
    onResetModule: () => Promise<void>
    /** 页面内临时覆盖，按场景指纹失效 */
    onOverride: (workflowId: WorkflowId) => void
}

export interface WorkflowDescriptor {
    id: WorkflowId
    /** 页面展示名，供排查与后续侧栏标题同步使用 */
    label: string
    component: (props: WorkflowRenderProps) => JSX.Element
}

/** 工作流标识 → 页面组件；'home' 为未选择模块时的初始页，'placeholder' 为未接入模块的占位页 */
export const WORKFLOWS: Readonly<Record<WorkflowId, WorkflowDescriptor>> = {
    chat: { id: 'chat', label: 'AI 对话', component: AiChat },
    placeholder: { id: 'placeholder', label: '待接入', component: WorkflowPlaceholder },
    home: { id: 'home', label: '模块选择', component: WorkflowHome },
}
