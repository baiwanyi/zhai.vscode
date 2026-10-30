/**
 * 写作管理工作流页：当前文档归属为作品时由 WorkflowScreen 渲染本文件。
 * 复用约定：文档读取与写盘交给 hooks/usePressWorkspace，结构性变更交给 usePressMutations，
 * 分区渲染交给 layout/PressSectionRouter；分区状态由外壳托管（section / onSelectSection），
 * 侧边导航在 WorkflowScreen 层常驻，本页不再自绘导航、也不自行处理宿主视图请求。
 * 作品数据来自宿主读取的 设定.md / 角色设定.md / 大纲.md，经本模块 document 解析成 OutlineWorkspace。
 * 关键约束：本页只负责分区内容与三态渲染（读取中 / 未打开作品 / 就绪），不直接发请求、不直接改草稿；
 * 读取中的骨架按 AppPage 的真实结构摆放（页头标题 + 动作区、内容区卡片），避免等待期间页面高度塌陷；
 * 作品定位只认宿主下发的 projectDir；未打开作品时渲染初始页（作品清单入口），不在页面内伪造示例数据。
 */
import { useCallback } from 'react'
import { Skeleton } from '@components/ui/skeleton'
import type { WorkflowContextState } from '@shared/types/workflow'
import { AppContent, AppHeader, AppPage } from '@webview/components/AppPage'
import { usePressMutations } from './hooks/usePressMutations'
import { usePressWorkspace } from './hooks/usePressWorkspace'
import { PressSectionRouter } from './layout/PressSectionRouter'
import { PressWorkspaceStart } from './layout/PressWorkspaceStart'
import type { WorkflowSection } from '../layout/workflowSections'
import type { JSX } from 'react'

/** 流程步骤到分区的映射：第 1 步与第 5 步都落到章节写作，正文由 AI 对话承接 */
const STEP_SECTIONS: Readonly<Record<number, WorkflowSection>> = {
    1: 'chapter',
    2: 'setting',
    3: 'character',
    4: 'outline',
    5: 'chapter',
}

/** 写作管理页入参：路由事实与当前分区都由外壳托管，页面不自行取路由或维护分区 */
interface WorkflowPressProps {
    context: WorkflowContextState
    section: WorkflowSection
    onSelectSection: (section: WorkflowSection) => void
}

export function WorkflowPress({ context, section, onSelectSection }: WorkflowPressProps): JSX.Element {
    const workspaceState = usePressWorkspace(context.projectDir)
    const mutations = usePressMutations({
        getWorkspace: workspaceState.getWorkspace,
        updateWorkspace: workspaceState.updateWorkspace,
        flush: workspaceState.flush,
        scheduleFlush: workspaceState.scheduleFlush,
    })

    const handleSelectStep = useCallback(
        (step: number): void => {
            onSelectSection(STEP_SECTIONS[step] ?? 'chapter')
        },
        [onSelectSection],
    )

    const handleOpenChat = useCallback((): void => {
        onSelectSection('chat')
    }, [onSelectSection])

    // 读取中：按真实页面骨架摆放（页头标题 + 动作区、内容区两张卡片），等待期间高度不塌陷
    if (workspaceState.status === 'loading') {
        return (
            <AppPage>
                <AppHeader className="justify-between">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-8 w-20 rounded-md" />
                </AppHeader>
                <AppContent className="flex flex-col gap-2">
                    <Skeleton className="h-28 w-full rounded-xl" />
                    <Skeleton className="h-28 w-full rounded-xl" />
                </AppContent>
            </AppPage>
        )
    }

    const workspace = workspaceState.workspace
    if (workspace === null) {
        return <PressWorkspaceStart projects={workspaceState.projects} onOpenProject={mutations.openProject} />
    }

    return (
        <div className="h-full min-h-0 overflow-hidden">
            <PressSectionRouter
                section={section}
                workspace={workspace}
                dirPath={workspaceState.projectDir ?? ''}
                mutations={mutations}
                onSelectStep={handleSelectStep}
                onOpenChat={handleOpenChat}
            />
        </div>
    )
}
