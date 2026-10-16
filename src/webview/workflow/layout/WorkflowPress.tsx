/**
 * 写作管理工作流页：写作管理模块的专属落点，模块切换时由注册表直接渲染本文件，注册表不引用 aichat。
 * 复用约定：AI 对话能力以组件方式引入（../aichat 的 AiChat），右侧分区入口由同目录 WorkflowPressNav 承载，
 * 本页只做模块能力的组合，后续写作管理专属区块（章节、角色、设定等）在此叠加，无需改动注册表与路由表。
 * 关键约束：本页不自行发起路由请求，分区高亮仅为页内局部状态（不写入宿主路由）；换页时本页卸载重建，
 * 分区回到默认项，对话数据由宿主侧会话服务持有。
 */
import { useState } from 'react'
import { WorkflowPressNav, type WorkflowPressSection } from './WorkflowPressNav'
import type { JSX } from 'react'
import { AiChat } from '../aichat'

/** 默认分区：页面主体即 AI 对话，默认高亮与当前可见内容一致 */
const DEFAULT_SECTION: WorkflowPressSection = 'chat'

export function WorkflowPress(): JSX.Element {
    const [activeSection, setActiveSection] = useState<WorkflowPressSection>(DEFAULT_SECTION)

    return (
        <div className="flex h-screen">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <AiChat />
            </div>
            <WorkflowPressNav activeSection={activeSection} onSelect={setActiveSection} />
        </div>
    )
}
