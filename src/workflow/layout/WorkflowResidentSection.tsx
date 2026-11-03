/**
 * 常驻分区视图：文档不属于作品时承载 AI 对话、媒体、校对、用量等跨模块分区。
 * 复用约定：对话复用 workflow/aichat 的 WorkflowAiChat（projectDir 即会话作用域），校对与用量分别复用
 * proofread、usage 的页面组件，媒体与在线图库分别复用 workflow/media 的 WorkflowMedia / WorkflowStock
 * （两者的插入都作用于当前编辑器光标处）；
 * 快照以作品目录为前提，这里只给出提示而不渲染半成品页面。
 * 关键约束：对话按作用域目录隔离（笔记/公众号取模块目录，其他文档为通用对话），key 跟随作用域，
 * 切换文档归属时重建页面，命令选择与未发送正文不会串到另一个作用域。
 */
import { Archive } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { WorkflowAiChat } from '@webview/workflow/aichat/WorkflowAiChat'
import { WorkflowMedia } from '@webview/workflow/media/WorkflowMedia'
import { WorkflowStock } from '@webview/workflow/media/WorkflowStock'
import { WorkflowProofread } from '@webview/workflow/proofread/WorkflowProofread'
import { WorkflowUsage } from '@webview/workflow/usage/WorkflowUsage'
import type { WorkflowSection } from './workflowSections'
import type { JSX } from 'react'

interface WorkflowResidentSectionProps {
    section: WorkflowSection
    /** 内容作用域目录：笔记与公众号取模块目录，其余文档为 null（通用对话） */
    scopeDir: string | null
}

export function WorkflowResidentSection({ section, scopeDir }: WorkflowResidentSectionProps): JSX.Element {
    // 校对以编辑器中的当前文档为目标，切作用域即重建，避免上一个文档的问题列表残留
    if (section === 'proofread') {
        return <WorkflowProofread key={scopeDir ?? 'global'} />
    }
    // 用量是全局统计，不随内容归属隔离
    if (section === 'usage') {
        return <WorkflowUsage />
    }
    // 媒体在非作品文档下同样是完整页面：既能插入当前文档，也能直接出图（落为通用素材）
    if (section === 'media') {
        return <WorkflowMedia context={null} />
    }
    // 在线图库是独立分区：搜索 Unsplash 后直接插到当前文档光标处，插入口径与媒体库一致
    if (section === 'stock') {
        return <WorkflowStock />
    }
    // 快照以作品目录为前提：非作品文档下给出明确提示，避免渲染空数据页面
    if (section === 'snapshot') {
        return (
            <div className="flex h-full flex-col justify-center p-4">
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <Archive className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>快照需要作品上下文</EmptyTitle>
                        <EmptyDescription>
                            当前文档不属于任何作品，快照时间线以作品目录为前提。打开作品文档后会切回作品作用域。
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </div>
        )
    }
    // 对话按作用域隔离：key 跟随作用域目录，切换归属时重建页面
    return <WorkflowAiChat key={scopeDir ?? 'global'} projectDir={scopeDir} />
}
