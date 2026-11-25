/**
 * 写作管理工作流页：当前文档归属为作品时由 WorkflowScreen 渲染本文件。
 * 复用约定：作品数据与结构性变更统一由 hooks/usePressWorkspaceScope 装配（与公众号页的账号作用域同形），
 * 常驻分区交给 layout/WorkflowResidentSection（与公众号页同一分派顺序），作品专属分区交给 layout/PressSectionRouter；
 * 分区状态由外壳托管（section / onSelectSection），侧边导航在 WorkflowScreen 层常驻，
 * 本页不再自绘导航、也不自行处理宿主视图请求。
 * 作品数据来自宿主读取的 设定.md / 角色设定.md / 大纲.md，经本模块 document 解析成 OutlineWorkspace。
 * 关键约束：本页只负责分区内容与三态渲染（读取中 / 未打开作品 / 就绪），不直接发请求、不直接改草稿；
 * 常驻分区先于作品工作区状态分派 —— 对话等页面只依赖文档作用域，等作品文档读完再放行会先闪一层作品骨架；
 * 例外是媒体与快照：前者要带角色与设定上下文，后者是作品级时间线，二者仍需等作品数据；
 * 读取中交给 StateEmpty 的加载态（logo + 转圈 + 文案），等待期间不出现整片空白；
 * 作品定位只认宿主下发的 projectDir；未打开作品时渲染初始页（作品清单入口），不在页面内伪造示例数据。
 */
import type { WorkflowContextState } from '@shared/types/workflow'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { RESIDENT_SECTIONS, readScopeDir } from '@webview/workflow/layout/contentScope'
import { WorkflowResidentSection } from '@webview/workflow/layout/WorkflowResidentSection'
import { usePressWorkspaceScope } from './hooks/usePressWorkspaceScope'
import { PressSectionRouter } from './layout/PressSectionRouter'
import { PressWorkspaceStart } from './layout/PressWorkspaceStart'
import type { WorkflowSection } from '../layout/workflowSections'
import type { JSX } from 'react'

/** 写作管理页入参：路由事实与当前分区都由外壳托管，页面不自行取路由或维护分区 */
interface WorkflowPressProps {
    context: WorkflowContextState
    section: WorkflowSection
}

export function WorkflowPress({ context, section }: WorkflowPressProps): JSX.Element {
    const { status, workspace, projects, dirPath, mutations } = usePressWorkspaceScope(context.projectDir)

    // 对话作用域：整个作品一份对话，作品内换章不切会话
    const scopeDir = readScopeDir(context, 'press')

    /**
     * 常驻分区与作品数据无关，先于工作区状态分派（与公众号页同一顺序）：
     * 对话、在线图库、上传、校对、标注与用量直接给页面，作品文档未读完也不等。
     * 例外是媒体与快照——媒体在作品内要带角色与设定上下文（出图归属、设为封面），
     * 快照在作品内是作品级时间线，二者交给下面的分区路由，由它等作品数据。
     */
    if (RESIDENT_SECTIONS.includes(section) && section !== 'media' && section !== 'snapshot') {
        return (
            <WorkflowResidentSection
                section={section}
                scopeDir={scopeDir}
                docPath={context.docPath}
                projectTitle={workspace?.setting.title ?? null}
            />
        )
    }

    // 读取中：交给统一的加载态，等待期间不出现整片空白
    if (status === 'loading') {
        return <StateEmpty className="h-full" title="正在读取作品..." isLoading />
    }

    if (workspace === null) {
        return <PressWorkspaceStart projects={projects} onOpenProject={mutations.openProject} />
    }

    return (
        <PressSectionRouter
            section={section}
            workspace={workspace}
            dirPath={dirPath ?? ''}
            chatScope={scopeDir}
            mutations={mutations}
        />
    )
}
