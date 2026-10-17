/**
 * 写作管理页（/press）：页头返回入口 + 作品列表 + 添加作品弹窗，是仪表盘内的作品管理落点。
 * 数据与动作经 hooks/usePressProjects 下发，页面只做编排；操作结果由数据层经 sonner 反馈。
 * 关键约束：创建成功即关闭弹窗，列表刷新由数据层完成后落地；页面内屏蔽浏览器右键菜单，
 * 与仪表盘首页保持一致；滚动区顶部同样叠渐隐遮罩，避免内容与页头硬切。
 */
import { useCallback, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import type { PressCategory } from '@/shared/types/press'
import { usePressProjects } from './hooks/usePressProjects'
import { PressProjectDialog } from './layout/PressProjectDialog'
import { PressProjectList } from './layout/PressProjectList'
import { PressTopBar } from './layout/PressTopBar'
import type { JSX } from 'react'
import { useVscodeTheme } from '../hooks/useVscodeTheme'

interface DashboardPressProps {
    /** 返回仪表盘概览：由路由外壳下发，页面不自行改写 hash */
    onBack: () => void
}

export function DashboardPress({ onBack }: DashboardPressProps): JSX.Element {
    const { projects, status, error, isCreating, reload, createProject, openProject, rebuildIndex } = usePressProjects()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    /** 弹窗实例序号：每次打开都换 key，重挂载即把表单恢复到初始值，避免 effect 内同步写状态 */
    const [dialogKey, setDialogKey] = useState(0)
    const theme = useVscodeTheme()

    const openDialog = useCallback((): void => {
        setDialogKey((previous) => previous + 1)
        setIsDialogOpen(true)
    }, [])

    const handleCreate = useCallback(
        async (name: string, category: PressCategory): Promise<boolean> => {
            const isCreated = await createProject(name, category)
            if (isCreated) {
                setIsDialogOpen(false)
            }
            return isCreated
        },
        [createProject],
    )

    return (
        <div className="flex h-screen flex-col pt-3" onContextMenu={(event) => event.preventDefault()}>
            <div className="px-3">
                <PressTopBar isCreating={isCreating} onBack={onBack} onAdd={openDialog} />
            </div>
            <div className="relative min-h-0 flex-1 pt-3">
                <ScrollArea className="h-full">
                    <div className="flex flex-col gap-3 p-3">
                        <PressProjectList
                            projects={projects}
                            status={status}
                            error={error}
                            onOpen={(dirPath) => void openProject(dirPath)}
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
            <Toaster theme={theme} />
        </div>
    )
}
