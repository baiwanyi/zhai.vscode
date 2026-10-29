/**
 * 写作管理工作流页：写作管理模块的专属落点，模块切换时由注册表直接渲染本文件。
 * 复用约定：文档读取与写盘交给 ../press/hooks/usePressWorkspace，结构性变更交给 usePressMutations，
 * 分区渲染交给 ../press/layout/PressSectionRouter，右侧分区入口由同目录 WorkflowPressNav 承载；
 * 作品数据来自宿主读取的 设定.md / 角色设定.md / 大纲.md，经 press/document 解析成 OutlineWorkspace。
 * 关键约束：本页只负责分区切换与三态渲染（读取中 / 未打开作品 / 就绪），不直接发请求、不直接改草稿；
 * 作品定位只认宿主下发的 projectDir；未打开作品时渲染初始页（作品清单入口），不在页面内伪造示例数据。
 */
import { useCallback, useState } from 'react'
import { Skeleton } from '@components/ui/skeleton'
import { normalizePressSection } from './pressSections'
import { WorkflowPressNav } from './WorkflowPressNav'
import type { WorkflowPressSection } from './pressSections'
import type { WorkflowRenderProps } from '../core/registry'
import type { JSX } from 'react'
import { usePressMutations } from '../press/hooks/usePressMutations'
import { usePressWorkspace } from '../press/hooks/usePressWorkspace'
import { PressSectionRouter } from '../press/layout/PressSectionRouter'
import { PressWorkspaceStart } from '../press/layout/PressWorkspaceStart'

/** 默认分区：页面主体即 AI 对话，默认高亮与当前可见内容一致 */
const DEFAULT_SECTION: WorkflowPressSection = 'chat'

/** 流程步骤到分区的映射：第 1 步与第 5 步都落到章节写作，正文由 AI 对话承接 */
const STEP_SECTIONS: Readonly<Record<number, WorkflowPressSection>> = {
    1: 'chapter',
    2: 'setting',
    3: 'character',
    4: 'outline',
    5: 'chapter',
}

export function WorkflowPress({ context, viewRequest }: WorkflowRenderProps): JSX.Element {
    const [activeSection, setActiveSection] = useState<WorkflowPressSection>(DEFAULT_SECTION)
    const [appliedViewSeq, setAppliedViewSeq] = useState<number | null>(null)

    /**
     * 宿主发起的页内跳转（如「添加到宅对话」后落到对话分区）：在渲染期对齐，不放进 effect，
     * 否则要多一轮渲染才能看到目标分区。按序号比对，同一分区被连续请求时也会重新落位；
     * 不属于本页的视图标识只记序号、不切分区，宿主新增页面时不会把这里切到空白。
     */
    if (viewRequest !== null && viewRequest.seq !== appliedViewSeq) {
        setAppliedViewSeq(viewRequest.seq)
        // 旧标识 image 映射为 media：存量视图请求仍能落到媒体页
        const nextSection = normalizePressSection(viewRequest.view)
        if (nextSection !== null) {
            setActiveSection(nextSection)
        }
    }

    const workspaceState = usePressWorkspace(context.projectDir)
    const mutations = usePressMutations({
        getWorkspace: workspaceState.getWorkspace,
        updateWorkspace: workspaceState.updateWorkspace,
        flush: workspaceState.flush,
        scheduleFlush: workspaceState.scheduleFlush,
    })

    const handleSelectStep = useCallback((step: number): void => {
        setActiveSection(STEP_SECTIONS[step] ?? 'chapter')
    }, [])

    const handleOpenChat = useCallback((): void => {
        setActiveSection('chat')
    }, [])

    if (workspaceState.status === 'loading') {
        return (
            <div className="flex h-screen flex-col gap-2 p-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
            </div>
        )
    }

    const workspace = workspaceState.workspace
    if (workspace === null) {
        return <PressWorkspaceStart projects={workspaceState.projects} onOpenProject={mutations.openProject} />
    }

    return (
        <div className="flex h-screen min-h-0">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <PressSectionRouter
                    section={activeSection}
                    workspace={workspace}
                    dirPath={workspaceState.projectDir ?? ''}
                    mutations={mutations}
                    onSelectStep={handleSelectStep}
                    onOpenChat={handleOpenChat}
                />
            </div>
            <WorkflowPressNav activeSection={activeSection} onSelect={setActiveSection} />
        </div>
    )
}
