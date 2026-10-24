/**
 * 工作流初始页：未选择任何模块时的落点，提供模块选择入口。
 * 复用 @components/ui 的 empty / button 组合；入口清单由 routing 的模块映射派生，新增模块无需改动本组件。
 * 关键约束：选定动作交由宿主落库并广播（onOpenModule），本组件不自行解析路由；
 * 失败经 sonner 提示，不在页面内渲染内联错误文本，也不改变页面状态。
 */
import { LayoutGrid, MessagesSquare, Pencil } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { WorkflowContextState, WorkflowId } from '@shared/types/workflow'
import { toastError } from '@shared/utils/error'
import type { JSX } from 'react'
import { MODULE_WORKFLOW, readModuleLabel } from '../core/routing'

/** 公众号管理模块键：仅用于区分入口图标 */
const WECHAT_MODULE_KEY = 'wechat'

/** 可选模块：直接取路由表的键，保证入口清单与映射关系不会两处失配 */
const MODULE_ENTRIES: string[] = Object.keys(MODULE_WORKFLOW)

interface WorkflowHomeProps {
    context: WorkflowContextState
    onOpenModule: (module: string) => Promise<void>
    onResetModule: () => Promise<void>
    onOverride: (workflowId: WorkflowId) => void
}

export function WorkflowHome({ onOpenModule }: WorkflowHomeProps): JSX.Element {
    const handleOpen = async (module: string): Promise<void> => {
        try {
            await onOpenModule(module)
        } catch (cause) {
            toastError(cause)
        }
    }

    return (
        <div className="flex h-screen flex-col justify-center p-4">
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                        <LayoutGrid className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>选择要进入的模块</EmptyTitle>
                    <EmptyDescription>尚未选择模块。从下方入口进入，或在仪表盘打开模块入口。</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    {MODULE_ENTRIES.map((module) => (
                        <Button key={module} variant="outline" onClick={() => void handleOpen(module)}>
                            {module === WECHAT_MODULE_KEY ? (
                                <MessagesSquare data-icon="inline-start" />
                            ) : (
                                <Pencil data-icon="inline-start" />
                            )}
                            {readModuleLabel(module)}
                        </Button>
                    ))}
                </EmptyContent>
            </Empty>
        </div>
    )
}
