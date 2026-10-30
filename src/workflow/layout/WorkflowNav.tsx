/**
 * 工作流侧边导航：全局常驻的纵向图标列，入口分「常驻分区」与「当前内容的专属分区」两类。
 * 分组自上而下为「AI 对话 → 中段（专属分区 + 媒体与校对，可滚动）→ 快照与 AI 使用量」，
 * 专属分区由内容归属决定：作品显示设定/角色/大纲/取名，公众号显示菜单/素材/统计/留言/用户/推送，
 * 其余文档只显示常驻分区，专属组与它的分隔线都不渲染。
 * 复用约定：受控组件，激活分区、内容归属与选中动作由外壳传入；文案与图标集中在 SECTION_META，
 * 分组只声明分区 id 顺序，专属分区清单见 contentScope 的 SCOPE_SECTIONS；
 * 配色取 globals.css 桥接的活动栏主题令牌，不写死色值。
 * 关键约束：分区项点击只切换高亮，本组件不承载保存动作，也不解析路由、不发起宿主命令；
 * 公众号六项加常驻项共 12 项（每项 48px），短面板下必然溢出，故中段自带纵向滚动且必须有 min-h-0，
 * 否则 flex 子项不会收缩、滚动条不出现；Tooltip 经 Portal 渲染到 body，滚动容器裁不到它。
 */
import {
    Archive,
    BarChart3,
    BookOpen,
    Bot,
    FolderOpen,
    Globe,
    Image as ImageIcon,
    ListTree,
    Menu,
    MessageCircle,
    MessageSquare,
    Send,
    SpellCheck,
    UserRound,
    Users,
    WandSparkles,
} from 'lucide-react'
import { TooltipProvider } from '@components/ui/tooltip'
import { SCOPE_SECTIONS } from './contentScope'
import { WorkflowNavItem } from './WorkflowNavItem'
import type { ContentScope } from './contentScope'
import type { WorkflowSection } from './workflowSections'
import type { JSX, ReactNode } from 'react'

/** 分组的渲染顺序：首项独占一组，中段承载专属分区与工具入口，尾项落栏底 */
const LEADING_SECTIONS: readonly WorkflowSection[] = ['chat']
const TOOL_SECTIONS: readonly WorkflowSection[] = ['media', 'proofread']
const FOOTER_SECTIONS: readonly WorkflowSection[] = ['snapshot', 'usage']

interface SectionMeta {
    label: string
    icon: ReactNode
}

/** 分区 → 文案与图标：章节写作没有导航入口，只由大纲页的步骤跳转进入，此处登记仅为满足类型完整性 */
const SECTION_META: Readonly<Record<WorkflowSection, SectionMeta>> = {
    chat: { label: 'AI对话', icon: <MessageCircle className="size-6" /> },
    setting: { label: '设定', icon: <Globe className="size-6" /> },
    character: { label: '角色', icon: <Users className="size-6" /> },
    outline: { label: '大纲', icon: <ListTree className="size-6" /> },
    naming: { label: '取名', icon: <WandSparkles className="size-6" /> },
    menu: { label: '自定义菜单', icon: <Menu className="size-6" /> },
    material: { label: '素材管理', icon: <FolderOpen className="size-6" /> },
    stats: { label: '数据统计', icon: <BarChart3 className="size-6" /> },
    comment: { label: '留言管理', icon: <MessageSquare className="size-6" /> },
    // 与写作管理的「角色」区分：这里指公众号粉丝，图标刻意不用 Users
    fans: { label: '用户管理', icon: <UserRound className="size-6" /> },
    push: { label: '推送管理', icon: <Send className="size-6" /> },
    media: { label: '媒体', icon: <ImageIcon className="size-6" /> },
    proofread: { label: '校对', icon: <SpellCheck className="size-6" /> },
    snapshot: { label: '快照', icon: <Archive className="size-6" /> },
    usage: { label: 'AI使用量', icon: <Bot className="size-6" /> },
    chapter: { label: '章节写作', icon: <BookOpen className="size-6" /> },
}

/** 分组分隔线：栏宽只有 48px，左右各留 8px；透明度用 opacity 而非颜色修饰符——
 *  活动栏前景色取自 VSCode 主题变量，Tailwind 无法为其合成带透明度的色值，会静默丢弃修饰符 */
function NavSeparator(): JSX.Element {
    return <div className="mx-2 my-1 h-px shrink-0 bg-activity-bar-inactive-foreground opacity-25" />
}

interface WorkflowNavProps {
    /** 当前分区：与页面内容同源，由外壳托管 */
    activeSection: WorkflowSection
    /** 当前内容归属：null 表示文档不属于任何已接入模块，此时不渲染专属分区 */
    scope: ContentScope | null
    onSelect: (section: WorkflowSection) => void
}

export function WorkflowNav({ activeSection, scope, onSelect }: WorkflowNavProps): JSX.Element {
    const scopeSections = scope === null ? [] : SCOPE_SECTIONS[scope]
    const renderItem = (section: WorkflowSection): JSX.Element => {
        const meta = SECTION_META[section]
        return (
            <WorkflowNavItem
                key={section}
                label={meta.label}
                icon={meta.icon}
                isActive={section === activeSection}
                onSelect={() => onSelect(section)}
            />
        )
    }

    return (
        <nav className="flex w-12 shrink-0 flex-col bg-activity-bar py-1 mr-1 rounded-md" aria-label="工作流导航">
            <TooltipProvider>
                {LEADING_SECTIONS.map(renderItem)}
                {/* 中段：专属分区与工具入口一起滚动，短面板下也能滚到最末一项 */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                    {scopeSections.length > 0 && (
                        <>
                            <NavSeparator />
                            {scopeSections.map(renderItem)}
                        </>
                    )}
                    <NavSeparator />
                    {TOOL_SECTIONS.map(renderItem)}
                </div>
                {FOOTER_SECTIONS.map(renderItem)}
            </TooltipProvider>
        </nav>
    )
}
