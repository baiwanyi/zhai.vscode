/**
 * 写作管理页右侧分区导航栏：以纵向图标列承载页内分区入口（章节信息、角色、设定、AI对话、工具），
 * 视觉与交互对齐 VSCode 原生「活动栏」（48px 栏宽、24px 图标、贴内容区一侧的 2px 高亮条、提示悬浮于左侧）。
 * 复用约定：受控组件，激活标识与选中动作由页面传入；配色全部取 globals.css 桥接的活动栏主题令牌，
 * 不写死色值；单项由同目录 WorkflowPressNavItem 渲染，入口清单集中在本文件，增减入口只改清单。
 * 关键约束：本期为占位入口，点击只切换高亮、不改变主内容；本组件不解析路由、不发起宿主命令；
 * 容器不可设置 overflow: hidden，否则 Tooltip 浮层会被裁切。
 */
import { Globe, MessageCircle, ScrollText, Users, Wrench } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkflowPressNavItem } from './WorkflowPressNavItem'
import type { JSX, ReactNode } from 'react'

/** 分区标识：与导航项一一对应，页面据此保存当前分区 */
export type WorkflowPressSection = 'chapter' | 'character' | 'setting' | 'chat' | 'tools'

interface WorkflowPressNavEntry {
    id: WorkflowPressSection
    label: string
    icon: ReactNode
}

/** 主功能分区：与活动栏一致置于栏顶 */
const PRIMARY_ENTRIES: readonly WorkflowPressNavEntry[] = [
    { id: 'chapter', label: '章节信息', icon: <ScrollText className="size-6" /> },
    { id: 'character', label: '角色', icon: <Users className="size-6" /> },
    { id: 'setting', label: '设定', icon: <Globe className="size-6" /> },
    { id: 'chat', label: 'AI对话', icon: <MessageCircle className="size-6" /> },
]

/** 辅助功能分区：置于栏底，与主功能区间留白分隔，对齐活动栏的底部入口分布 */
const FOOTER_ENTRIES: readonly WorkflowPressNavEntry[] = [
    { id: 'tools', label: '工具', icon: <Wrench className="size-6" /> },
]

interface WorkflowPressNavProps {
    activeSection: WorkflowPressSection
    onSelect: (section: WorkflowPressSection) => void
}

export function WorkflowPressNav({ activeSection, onSelect }: WorkflowPressNavProps): JSX.Element {
    return (
        <nav className="flex w-12 shrink-0 flex-col bg-activity-bar py-1 mr-1 rounded-md" aria-label="写作管理导航">
            <TooltipProvider>
                {PRIMARY_ENTRIES.map((entry) => (
                    <WorkflowPressNavItem
                        key={entry.id}
                        label={entry.label}
                        icon={entry.icon}
                        isActive={entry.id === activeSection}
                        onSelect={() => onSelect(entry.id)}
                    />
                ))}
                {/* 弹性留白：把辅助入口压到栏底，形成与活动栏一致的上下分组 */}
                <div className="flex-1" />
                {FOOTER_ENTRIES.map((entry) => (
                    <WorkflowPressNavItem
                        key={entry.id}
                        label={entry.label}
                        icon={entry.icon}
                        isActive={entry.id === activeSection}
                        onSelect={() => onSelect(entry.id)}
                    />
                ))}
            </TooltipProvider>
        </nav>
    )
}
