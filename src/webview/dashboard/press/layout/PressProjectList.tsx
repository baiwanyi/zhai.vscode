/**
 * 作品列表区块：按加载状态分派，加载中给骨架、失败给重试、无数据给引导、有数据给条目列表。
 * 复用 @components/ui 的 item、PressStateViews 的骨架与失败块、业务公共层的 StateEmpty 空态；
 * 标题与作品数量由页面页头承担，本组件只负责内容，故不再套卡片外壳。
 * 关键约束：条目组须显式声明 w-full，宽度跟随 AppContent 的可用宽度撑满，不随内容收缩；
 * 空态同时提供「添加作品」与「重建索引」，后者用于索引缓存被清空后恢复列表；
 * 「添加作品」在导入流程占用弹窗位时由页面置灰，避免与导入确认弹窗叠加；
 * 加载态与失败态走共用状态视图，避免与作品详情页各写一套。
 */
import { BookOpen } from 'lucide-react'
import { ItemGroup } from '@components/ui/item'
import type { PressProjectSummary } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { PressProjectItem } from './PressProjectItem'
import { PressErrorState, PressSkeletonList } from './PressStateViews'
import type { PressStatus } from '../utils'
import type { JSX } from 'react'

interface PressProjectListProps {
    projects: PressProjectSummary[]
    status: PressStatus
    error: string | null
    /** 空态的「添加作品」是否禁用：导入流程占用弹窗位时置灰，避免两个弹窗叠加 */
    isAddDisabled: boolean
    onSelect: (dirPath: string) => void
    onAdd: () => void
    onRebuild: () => void
    onRetry: () => void
}

export function PressProjectList({
    projects,
    status,
    error,
    isAddDisabled,
    onSelect,
    onAdd,
    onRebuild,
    onRetry,
}: PressProjectListProps): JSX.Element {
    if (status === 'loading') {
        return <PressSkeletonList count={3} itemClassName="h-12 rounded-xl" />
    }

    if (status === 'error') {
        return <PressErrorState title="作品列表加载失败" message={error} onRetry={onRetry} />
    }

    if (projects.length === 0) {
        return (
            <StateEmpty
                title="还没有作品"
                description="作品以 press/ 下的子目录组织，新建后会自动生成背景、大纲与角色设定骨架文档。"
                icon={BookOpen}
            >
                <Button disabled={isAddDisabled} onClick={onAdd}>
                    添加作品
                </Button>
                <Button variant="outline" onClick={onRebuild}>
                    重建索引
                </Button>
            </StateEmpty>
        )
    }

    return (
        <ItemGroup className="gap-2">
            {projects.map((project) => (
                <PressProjectItem key={project.dirPath} project={project} onSelect={onSelect} />
            ))}
        </ItemGroup>
    )
}
