/**
 * 工作流页面注册表：把工作流标识映射到具体页面组件，是路由结果唯一的渲染落点。
 * 复用约定：路由规则见 ./routing，组件只接收路由事实与覆盖回调，自身不发起路由请求。
 * 关键约束：新增工作流须同时登记此处与 ./routing 的映射表，否则解析结果无法渲染。
 */
import type { WorkflowContextState, WorkflowId } from '@/shared/types/workflow'
import { AiChat } from './aichat'
import { WorkflowPlaceholder } from './layout/WorkflowPlaceholder'
import type { JSX } from 'react'

/** 工作流组件入参：路由事实由宿主下发，覆盖动作经回调交还宿主层 */
export interface WorkflowRenderProps {
    context: WorkflowContextState
    onOverride: (workflowId: WorkflowId) => void
}

export interface WorkflowDescriptor {
    id: WorkflowId
    /** 页面展示名，供排查与后续侧栏标题同步使用 */
    label: string
    component: (props: WorkflowRenderProps) => JSX.Element
}

/** 工作流标识 → 页面组件；'chat' 为既有的 AI 对话页，'placeholder' 为未接入场景的统一占位页 */
export const WORKFLOWS: Readonly<Record<WorkflowId, WorkflowDescriptor>> = {
    chat: { id: 'chat', label: 'AI 对话', component: AiChat },
    placeholder: { id: 'placeholder', label: '待接入', component: WorkflowPlaceholder },
}
