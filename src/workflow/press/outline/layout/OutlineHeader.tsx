/**
 * 大纲页头：装配标题、打开文档、随模块变化的新增入口、动作菜单、进度摘要与筛选栏。
 * 复用约定：按钮取 @webview/components/Button，动作菜单与筛选栏复用同目录组件，进度条取 ui/progress；
 * 摘要统计与筛选选项由调用方派生后传入，本组件不持有任何工作区数据。
 * 关键约束：新增入口的文案与图标由 module 查模块级 ADD_ACTION_META，点击回调由调用方按同一 module 解析；
 * 筛选与模块切换只视图联动，清空选中等副作用由调用方在 onModuleChange / onVolumeChange 内处理。
 */
import { FileText } from 'lucide-react'
import { Progress } from '@components/ui/progress'
import { AppAction, AppHeader, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { OutlineActionMenu } from './OutlineActionMenu'
import { OutlineFilterMenus } from './OutlineFilterMenus'
import type { CharacterCard, OutlineExtractTarget, OutlineModuleKey, OutlinePlan, OutlineVolume } from '../../types'
import type { summarizeWorkspace } from '../../utils'
import type { JSX, ReactNode } from 'react'

interface OutlineHeaderProps {
    dirPath: string
    volumes: OutlineVolume[]
    plan: OutlinePlan
    characters: CharacterCard[]
    title: string
    volumeCount: number
    module: OutlineModuleKey
    volumeFilter: string
    query: string
    volumeOptions: readonly { value: string; label: string }[]
    summary: ReturnType<typeof summarizeWorkspace>
    donePercent: number
    isExtracting: boolean
    addAction: { label: string; icon: ReactNode }
    onAddAction: () => void
    onOpenDoc: () => void
    onExtract: (target: OutlineExtractTarget) => void
    onGenerateVolumeOutlines: () => void
    onApplyBackfill: (next: { volumes: OutlineVolume[]; plan: OutlinePlan }) => void
    onModuleChange: (module: OutlineModuleKey) => void
    onVolumeChange: (value: string) => void
    onQueryChange: (value: string) => void
}

export function OutlineHeader({
    dirPath,
    volumes,
    plan,
    characters,
    title,
    volumeCount,
    module,
    volumeFilter,
    query,
    volumeOptions,
    summary,
    donePercent,
    isExtracting,
    addAction,
    onAddAction,
    onOpenDoc,
    onExtract,
    onGenerateVolumeOutlines,
    onApplyBackfill,
    onModuleChange,
    onVolumeChange,
    onQueryChange,
}: OutlineHeaderProps): JSX.Element {
    return (
        <AppHeader>
            <AppTitle>大纲</AppTitle>
            <AppAction>
                <Button variant="outline" tooltip="打开大纲文档，卷纲与章纲的原文可直接编辑" onClick={onOpenDoc}>
                    <FileText />
                    打开文档
                </Button>
                {/* 页头只留一个新增入口：加什么由当前模块标签决定，不再开菜单选类型 */}
                <Button onClick={onAddAction}>
                    {addAction.icon}
                    {addAction.label}
                </Button>
                <OutlineActionMenu
                    dirPath={dirPath}
                    volumes={volumes}
                    plan={plan}
                    characters={characters}
                    isExtracting={isExtracting}
                    onExtract={onExtract}
                    onGenerateVolumeOutlines={onGenerateVolumeOutlines}
                    onApplyBackfill={onApplyBackfill}
                />
            </AppAction>
            <AppSummary
                title={title}
                path={dirPath}
                meta={`${volumeCount} 卷 · ${summary.chapters} 章 · 已写 ${summary.done} 章`}
            >
                <div className="flex w-full items-center gap-2">
                    <Progress
                        value={donePercent}
                        className="h-1 min-w-0 flex-1"
                        aria-label={`章节完成度 ${donePercent}%`}
                    />
                    <span className="shrink-0 text-muted-foreground tabular-nums">{donePercent}%</span>
                </div>
            </AppSummary>
            <OutlineFilterMenus
                module={module}
                volumeFilter={volumeFilter}
                volumeOptions={volumeOptions}
                query={query}
                onModuleChange={onModuleChange}
                onVolumeChange={onVolumeChange}
                onQueryChange={onQueryChange}
            />
        </AppHeader>
    )
}
