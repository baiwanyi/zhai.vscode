/**
 * 写作管理页（#/press）：页头返回入口 + 作品列表 + 底部添加/导入入口 + 新建与 TXT 导入两个弹窗，是仪表盘内的作品管理落点。
 * 复用约定：外壳取 components/AppPage（页头走 AppHeader、列表走 AppContent 滚动、写操作入口走 AppFooter、两个弹窗挂在骨架外）；
 * 数据与动作经 hooks/usePressProjects 与 hooks/usePressImport 下发，页面只做编排，并把内联箭头收敛为稳定回调；
 * 操作结果由两个数据层经 sonner 反馈，导入进度按固定 toast id 原地更新。
 * 关键约束：点击作品交由路由外壳跳详情页（本页不直接打开 README）；创建成功即关闭弹窗，失败保留输入；
 * 新建与导入两个弹窗互斥：导入流程（选文件中或候选待确认）期间不打开新建弹窗，新建弹窗打开期间不启动选文件；
 * 导入只写入正文，不在此触发 AI 归纳（归纳由作品设定页与大纲页手动发起）；
 * 导入确认弹窗以 token 作 key，切换候选文件即重挂载，表单回到该文件的建议值；
 * 页面内屏蔽浏览器右键菜单，与仪表盘首页保持一致。
 */
import { useCallback, useState } from 'react'
import type { PressAudience } from '@shared/types/press'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { usePressImport } from './hooks/usePressImport'
import { usePressProjects } from './hooks/usePressProjects'
import { PressFooterActions } from './layout/PressFooterActions'
import { PressImportDialog } from './layout/PressImportDialog'
import { PressProjectDialog } from './layout/PressProjectDialog'
import { PressProjectList } from './layout/PressProjectList'
import type { JSX } from 'react'
import { DashboardBackAction } from '../layout/DashboardBackAction'

interface DashboardPressProps {
    /** 打开作品详情：由路由外壳下发，落地到 #/press/{作品名} */
    onOpenProject: (dirPath: string) => void
}

export function DashboardPress({ onOpenProject }: DashboardPressProps): JSX.Element {
    const { projects, status, error, isCreating, reload, createProject, rebuildIndex } = usePressProjects()
    const { candidate, isPicking, isImporting, pick, start, dismiss } = usePressImport()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    /** 弹窗实例序号：每次打开都换 key，重挂载即把表单恢复到初始值，避免 effect 内同步写状态 */
    const [dialogKey, setDialogKey] = useState(0)

    /** 导入流程（选文件中或候选待确认）占住弹窗位：与新建作品弹窗互斥，避免两个弹窗叠加 */
    const isImportFlowActive = isPicking || candidate !== null
    /** 新建与导入互斥：任一进行中同时禁用底部两个入口，避免并发写同一个作品目录 */
    const isBusy = isCreating || isImporting || isPicking
    /** 页头只在列表就绪且有数据时展示数量，加载与失败态不暴露旧快照 */
    const projectCount = status === 'ready' ? projects.length : 0

    const openDialog = useCallback((): void => {
        if (isImportFlowActive) {
            return
        }
        setDialogKey((previous) => previous + 1)
        setIsDialogOpen(true)
    }, [isImportFlowActive])

    /** 创建成功后关闭弹窗；失败时保持打开，让用户就地修正输入 */
    const handleCreate = useCallback(
        async (name: string, audience: PressAudience): Promise<boolean> => {
            const isCreated = await createProject(name, audience)
            if (isCreated) {
                setIsDialogOpen(false)
            }
            return isCreated
        },
        [createProject],
    )

    const handleRetry = useCallback((): void => {
        void reload()
    }, [reload])

    const handleRebuild = useCallback((): void => {
        void rebuildIndex()
    }, [rebuildIndex])

    /** 已有待确认候选或新建弹窗打开时不再启动选文件，先结束当前流程 */
    const handlePick = useCallback((): void => {
        if (isDialogOpen || candidate !== null) {
            return
        }
        void pick()
    }, [candidate, isDialogOpen, pick])

    const handleImportOpenChange = useCallback(
        (open: boolean): void => {
            if (!open) {
                dismiss()
            }
        },
        [dismiss],
    )

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle>作品列表</AppTitle>
                    <DashboardBackAction kind="home" />
                    {projectCount > 0 && <AppDescription>{`${String(projectCount)} 部`}</AppDescription>}
                </AppHeader>
                <AppContent isScrollable>
                    <PressProjectList
                        projects={projects}
                        status={status}
                        error={error}
                        isAddDisabled={isImportFlowActive}
                        onSelect={onOpenProject}
                        onAdd={openDialog}
                        onRebuild={handleRebuild}
                        onRetry={handleRetry}
                    />
                </AppContent>
                <AppFooter>
                    <PressFooterActions isBusy={isBusy} onAdd={openDialog} onImport={handlePick} />
                </AppFooter>
            </AppPage>

            <PressProjectDialog
                key={dialogKey}
                open={isDialogOpen}
                isSubmitting={isCreating}
                onOpenChange={setIsDialogOpen}
                onSubmit={handleCreate}
            />

            <PressImportDialog
                key={candidate?.token ?? 'idle'}
                open={candidate !== null}
                candidate={candidate}
                isImporting={isImporting}
                onOpenChange={handleImportOpenChange}
                onSubmit={start}
            />
        </>
    )
}
