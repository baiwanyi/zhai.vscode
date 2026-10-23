/**
 * 写作管理页（#/press）：页头返回入口 + 作品列表 + 添加作品弹窗 + TXT 导入确认弹窗，是仪表盘内的作品管理落点。
 * 数据与动作经 hooks/usePressProjects 与 hooks/usePressImport 下发，页面只做编排；
 * 操作结果由两个数据层经 sonner 反馈，导入进度按固定 toast id 原地更新。
 * 关键约束：点击作品交由路由外壳跳详情页（本页不直接打开 README）；创建成功即关闭弹窗；
 * 导入确认弹窗以 token 作 key，切换候选文件即重挂载，表单回到该文件的建议值；
 * 页面内屏蔽浏览器右键菜单，与仪表盘首页保持一致。
 */
import { useCallback, useState } from 'react'
import { ScrollArea } from '@components/ui/scroll-area'
import type { PressAudience } from '@shared/types/press'
import { usePressImport } from './hooks/usePressImport'
import { usePressProjects } from './hooks/usePressProjects'
import { usePressSemantic } from './hooks/usePressSemantic'
import { PressImportDialog } from './layout/PressImportDialog'
import { PressProjectDialog } from './layout/PressProjectDialog'
import { PressProjectList } from './layout/PressProjectList'
import { PressTopBar } from './layout/PressTopBar'
import type { JSX } from 'react'

interface DashboardPressProps {
    /** 返回仪表盘概览：由路由外壳下发，页面不自行改写 hash */
    onBack: () => void
    /** 打开作品详情：由路由外壳下发，落地到 #/press/{作品名} */
    onOpenProject: (dirPath: string) => void
}

export function DashboardPress({ onBack, onOpenProject }: DashboardPressProps): JSX.Element {
    const { projects, status, error, isCreating, reload, createProject, rebuildIndex } = usePressProjects()
    const { start: startSemantic } = usePressSemantic('')
    /** 导入确认弹窗里的「导入后做 AI 归纳」开关：状态放在页面层，避免 hook 之间互相依赖 */
    const [shouldSummarize, setShouldSummarize] = useState(false)
    const handleImportCompleted = useCallback(
        (dirPath: string): void => {
            if (shouldSummarize) {
                void startSemantic(dirPath)
            }
        },
        [shouldSummarize, startSemantic],
    )
    const { candidate, isImporting, pick, start, dismiss } = usePressImport({ onCompleted: handleImportCompleted })
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    /** 弹窗实例序号：每次打开都换 key，重挂载即把表单恢复到初始值，避免 effect 内同步写状态 */
    const [dialogKey, setDialogKey] = useState(0)

    const openDialog = useCallback((): void => {
        setDialogKey((previous) => previous + 1)
        setIsDialogOpen(true)
    }, [])

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

    const handleImport = useCallback(
        async (name: string, audience: PressAudience): Promise<boolean> => start(name, audience),
        [start],
    )

    const handleImportOpenChange = useCallback(
        (open: boolean): void => {
            if (!open) {
                dismiss()
            }
        },
        [dismiss],
    )

    return (
        <div className="flex h-screen flex-col pt-3" onContextMenu={(event) => event.preventDefault()}>
            <div className="px-3">
                <PressTopBar
                    isCreating={isCreating}
                    isImporting={isImporting}
                    onBack={onBack}
                    onAdd={openDialog}
                    onImport={() => void pick()}
                />
            </div>
            <div className="relative min-h-0 flex-1 pt-3">
                <ScrollArea className="h-full">
                    <div className="flex flex-col gap-3 p-3">
                        <PressProjectList
                            projects={projects}
                            status={status}
                            error={error}
                            onSelect={onOpenProject}
                            onAdd={openDialog}
                            onRebuild={() => void rebuildIndex()}
                            onRetry={() => void reload()}
                        />
                    </div>
                </ScrollArea>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-linear-to-b from-background to-transparent" />
            </div>
            <PressProjectDialog
                key={dialogKey}
                open={isDialogOpen}
                isSubmitting={isCreating}
                onOpenChange={setIsDialogOpen}
                onSubmit={handleCreate}
            />
            <PressImportDialog
                key={candidate?.token ?? 'idle'}
                candidate={candidate}
                isImporting={isImporting}
                shouldSummarize={shouldSummarize}
                onSummaryChange={setShouldSummarize}
                onOpenChange={handleImportOpenChange}
                onSubmit={handleImport}
            />
        </div>
    )
}
