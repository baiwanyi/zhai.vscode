/**
 * 常驻分区视图：文档不属于作品时承载 AI 对话、媒体、快照、校对、用量等跨模块分区。
 * 复用约定：对话复用 workflow/aichat 的 WorkflowAiChat（projectDir 即会话作用域），校对与用量分别复用
 * proofread、usage 的页面组件，媒体、在线图库与上传分别复用 workflow/media 的 WorkflowMedia / WorkflowStock /
 * WorkflowUpload（前两者的插入都作用于当前编辑器光标处，上传只落盘不发正文）；
 * 快照按单文件时间线组织，篇章与公众号文章共用 press/snapshot 的单文件快照页。
 * 关键约束：对话按作用域目录隔离（微博取模块键、笔记取文档路径、作品取作品目录、公众号取批次目录），key 跟随作用域，
 * 切换文档归属时重建页面，命令选择与未发送正文不会串到另一个作用域；
 * 作品归属可传 projectTitle：只影响对话摘要行的作品名，不参与 key，作品读完后补上也不会重建页面；
 * 快照以 docPath 为键，没有活跃文档时只给引导空态，不渲染半成品页面。
 */
import { Archive } from 'lucide-react'
import { WEIBO_MODULE_KEY } from '@shared/types/workflow'
import { StateEmpty } from '@webview/components/StateEmpty'
import { WorkflowAiChat } from '@webview/workflow/aichat/WorkflowAiChat'
import { WorkflowAnnotation } from '@webview/workflow/annotation/WorkflowAnnotation'
import { WorkflowMedia } from '@webview/workflow/media/WorkflowMedia'
import { WorkflowStock } from '@webview/workflow/media/WorkflowStock'
import { WorkflowUpload } from '@webview/workflow/media/WorkflowUpload'
import { SingleDocSnapshotPage } from '@webview/workflow/press/snapshot/SingleDocSnapshotPage'
import { WorkflowProofread } from '@webview/workflow/proofread/WorkflowProofread'
import { WorkflowUsage } from '@webview/workflow/usage/WorkflowUsage'
import type { WorkflowSection } from './workflowSections'
import type { JSX } from 'react'

interface WorkflowResidentSectionProps {
    section: WorkflowSection
    /** 会话作用域键：通常是当前文档路径；没有活跃文档时取作品目录或模块键，其余为 null（通用对话） */
    scopeDir: string | null
    /** 当前活跃文档的相对路径：单文件快照以此为唯一键，无活跃文档时为 null */
    docPath: string | null
    /** 作品标题：仅作品归属传入，供对话摘要行展示；其余归属省略时摘要行回落通道名 */
    projectTitle?: string | null
}

export function WorkflowResidentSection({
    section,
    scopeDir,
    docPath,
    projectTitle = null,
}: WorkflowResidentSectionProps): JSX.Element {
    // 校对以编辑器中的当前文档为目标，切作用域即重建，避免上一个文档的问题列表残留
    if (section === 'proofread') {
        return <WorkflowProofread key={scopeDir ?? 'global'} />
    }
    // 用量是全局统计，不随内容归属隔离
    if (section === 'usage') {
        return <WorkflowUsage />
    }
    // 标注是跨文档视图：作品、笔记、公众号下看到的都是全库记录
    if (section === 'annotation') {
        return <WorkflowAnnotation />
    }
    // 媒体在非作品文档下同样是完整页面：既能插入当前文档，也能直接出图（落为通用素材）
    if (section === 'media') {
        return <WorkflowMedia context={null} />
    }
    // 在线图库是独立分区：搜索 Unsplash 后直接插到当前文档光标处，插入口径与媒体库一致
    if (section === 'stock') {
        return <WorkflowStock />
    }
    // 上传是独立分区：与文档、作品都无关，文件统一落存储根的 uploads 目录
    if (section === 'upload') {
        return <WorkflowUpload />
    }
    // 快照对任意 md 文档可用：单文件时间线以当前文档路径为键，按文档重建避免串版本
    if (section === 'snapshot') {
        if (docPath !== null) {
            return <SingleDocSnapshotPage key={docPath} docPath={docPath} />
        }
        return (
            <div className="flex h-full flex-col justify-center p-4">
                <StateEmpty
                    icon={Archive}
                    title="还没有打开文档"
                    description="快照以当前 Markdown 文档为单位。打开任意 .md 文件后，保存或手动留版都会在此留下历史版本。"
                />
            </div>
        )
    }
    // 对话按作用域隔离：key 跟随作用域目录，切换归属时重建页面；作品标题只影响摘要行，不参与 key；
    // 微博语境没有活动文档，开放输入门禁（对话只生成内容、不写回文件）
    return (
        <WorkflowAiChat
            key={scopeDir ?? 'global'}
            projectDir={scopeDir}
            projectTitle={projectTitle}
            hasWritableScopeOverride={scopeDir === WEIBO_MODULE_KEY ? true : undefined}
        />
    )
}
