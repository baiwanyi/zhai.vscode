/**
 * 工作流切换入口：浮在当前工作流页面上，用于在任意页面（含 AI 对话页）改选模块或返回初始页。
 * 复用 @/components/ui 的 dropdown-menu 与 button；入口清单由 routing 的模块映射派生，新增模块无需改动本组件。
 * 关键约束：以绝对定位浮层呈现且不占页面布局，避免侵入各工作流自身的顶部工具条与输入区；
 * 选定与清除动作交由宿主落库并广播，失败仅就地提示，不改变当前页面。
 */
import { LayoutGrid, MessagesSquare, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { WorkflowContextState } from '@/shared/types/workflow'
import type { JSX } from 'react'
import { MODULE_WORKFLOW, readModuleLabel } from '../routing'

/** 公众号管理模块键：仅用于区分入口图标 */
const WECHAT_MODULE_KEY = 'wechat'

/** 可选模块：直接取路由表的键，保证入口清单与映射关系不会两处失配 */
const MODULE_ENTRIES: string[] = Object.keys(MODULE_WORKFLOW)

interface WorkflowSwitcherProps {
    context: WorkflowContextState
    onOpenModule: (module: string) => Promise<void>
    onResetModule: () => Promise<void>
}

export function WorkflowSwitcher({ context, onOpenModule, onResetModule }: WorkflowSwitcherProps): JSX.Element {
    const [error, setError] = useState<string | null>(null)

    const run = async (action: () => Promise<void>): Promise<void> => {
        setError(null)
        try {
            await action()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }

    return (
        <div className="pointer-events-none absolute top-12 right-2 z-40">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        className="pointer-events-auto text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                        title="切换工作流"
                        aria-label="切换工作流"
                    >
                        <LayoutGrid />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel>当前：{readModuleLabel(context.module)}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {MODULE_ENTRIES.map((module) => (
                        <DropdownMenuItem key={module} onSelect={() => void run(() => onOpenModule(module))}>
                            {module === WECHAT_MODULE_KEY ? <MessagesSquare /> : <Pencil />}
                            {readModuleLabel(module)}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void run(onResetModule)}>返回模块选择</DropdownMenuItem>
                    {error !== null ? <p className="px-1.5 py-1 text-destructive text-xs">{error}</p> : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
