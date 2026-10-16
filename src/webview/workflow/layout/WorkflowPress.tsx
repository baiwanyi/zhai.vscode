/**
 * 写作管理工作流页：写作管理模块的专属落点，模块切换时由注册表直接渲染本文件，注册表不引用 aichat。
 * 复用约定：AI 对话能力以组件方式引入（../aichat 的 AiChat），本页只做模块能力的组合，
 * 后续写作管理专属区块（章节、素材等）在此叠加，无需改动注册表与路由表。
 * 关键约束：本页不自行发起路由请求；换页时本页卸载重建，对话数据由宿主侧会话服务持有。
 */
import type { JSX } from 'react'
import { AiChat } from '../aichat'

export function WorkflowPress(): JSX.Element {
    return <AiChat />
}
