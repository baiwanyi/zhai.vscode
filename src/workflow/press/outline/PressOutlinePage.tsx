/**
 * 大纲工作台：写作流程的第四步，左侧卷-章树、中间章纲详情、右侧 AI 副驾。
 * 复用约定：外壳取 components/AppPage（标题与动作走 AppHeader、作品名与卷章统计走 AppSummary、
 * 完成度进度走 AppMenu、三栏主体交给非滚动的 AppContent），三个区域分别由 OutlineTree、
 * OutlineDetail、OutlineAiPanel 承担，本文件负责选中项、筛选、折叠、向导与提取的编排；
 * 统计口径来自 utils 的 summarizeWorkspace。
 * 关键约束：宽容器用容器查询展开三栏，窄容器（VSCode 侧栏常态）退化为「树 → 详情」下钻，
 * 选中章节后必须隐藏树而不是压缩两栏；折叠状态记录的是「已折叠的卷」，新卷因此默认展开；
 * 头部「打开文档」按文档键打开大纲.md，与提取 / 生成大纲并列，不参与草稿状态；
 * 提取范围由 OutlineExtractMenu 选择：全篇整树覆盖，章节范围与指定章节只刷新所选章的章纲字段。
 * 三栏各自滚动，AppContent 不可用 isScrollable，只能给出 flex 容器并去掉默认左右内边距。
 */
import { cn } from 'cn'
import { FileText, ListTree, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Progress } from '@components/ui/progress'
import type { PressExtractedVolume } from '@shared/types/press'
import { AppAction, AppContent, AppHeader, AppMenu, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useOutlineExtract } from './hooks/useOutlineExtract'
import { OutlineAiPanel } from './layout/OutlineAiPanel'
import { OutlineDetail } from './layout/OutlineDetail'
import { OutlineExtractMenu } from './layout/OutlineExtractMenu'
import { OutlineTree } from './layout/OutlineTree'
import { OutlineWizard } from './layout/OutlineWizard'
import type {
    OutlineChapter,
    OutlineExtractTarget,
    OutlineTreeEntry,
    OutlineVolume,
    OutlineWorkspace,
    PlanStatus,
} from '../types'
import type { JSX } from 'react'
import { useOpenProjectDoc } from '../hooks/useOpenProjectDoc'
import { summarizeWorkspace } from '../utils'

interface PressOutlinePageProps {
    workspace: OutlineWorkspace
    /** 当前作品目录：提取大纲读取该作品的 Materials 素材 */
    dirPath: string
    defaultChapterWordGoal: number
    onUpdateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    onCreateVolume: () => void
    onCreateChapter: (volumeId: string) => void
    onApplyOutline: (volumes: OutlineVolume[]) => void
    /** 用素材重建大纲：mode 为 all 时覆盖整棵树，orders 时只刷新所选章，返回实际处理的章数 */
    onExtractOutline: (drafts: PressExtractedVolume[], target: OutlineExtractTarget) => number
    onOpenChat: () => void
}

export function PressOutlinePage({
    workspace,
    dirPath,
    defaultChapterWordGoal,
    onUpdateChapter,
    onCreateVolume,
    onCreateChapter,
    onApplyOutline,
    onExtractOutline,
    onOpenChat,
}: PressOutlinePageProps): JSX.Element {
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState<PlanStatus | 'all'>('all')
    const [collapsedVolumeIds, setCollapsedVolumeIds] = useState<string[]>([])
    const [isWizardOpen, setIsWizardOpen] = useState(false)
    const { isExtracting, extract } = useOutlineExtract(dirPath)
    const { openDoc } = useOpenProjectDoc(dirPath)

    const entries = useMemo<OutlineTreeEntry[]>(
        () => workspace.volumes.flatMap((volume) => volume.chapters.map((chapter) => ({ volume, chapter }))),
        [workspace.volumes],
    )
    const selectedEntry = entries.find((entry) => entry.chapter.id === selectedChapterId) ?? entries.at(0) ?? null
    const summary = summarizeWorkspace(workspace.volumes)
    const donePercent = summary.chapters > 0 ? Math.round((summary.done / summary.chapters) * 100) : 0
    // 下钻状态只看用户是否主动点选过：窄容器下初始停在树，宽容器由 @2xl 断点强制并排
    const hasActiveSelection = selectedChapterId !== null
    const expandedVolumeIds = workspace.volumes
        .map((volume) => volume.id)
        .filter((id) => !collapsedVolumeIds.includes(id))

    const handleToggleVolume = (volumeId: string): void => {
        setCollapsedVolumeIds((previous) =>
            previous.includes(volumeId) ? previous.filter((id) => id !== volumeId) : [...previous, volumeId],
        )
    }

    const handleSelectChapter = (chapterId: string): void => {
        setSelectedChapterId(chapterId)
    }

    /** 提取：target 决定整树覆盖还是刷新指定章；素材都是全量解析，范围只影响写入 */
    const handleExtract = (target: OutlineExtractTarget): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null) {
                return
            }
            if (result.volumes.length === 0) {
                toast.info(result.message)
                return
            }
            if (target.mode === 'all') {
                const chapterCount = onExtractOutline(result.volumes, target)
                // 重建后的卷章 id 全部换新，旧选中项已失效，回到默认的首章
                setSelectedChapterId(null)
                toast.success(`${result.message}，已替换当前大纲（${String(chapterCount)} 章）`)
                return
            }
            const refreshed = onExtractOutline(result.volumes, target)
            // 范围提取不改动章 id，选中项可以保留
            if (refreshed === 0) {
                toast.info('所选范围没有可刷新的章节，可能已超出素材覆盖的章数')
                return
            }
            toast.success(`${result.message}，已刷新 ${String(refreshed)} 章章纲`)
        }
        void run()
    }

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>大纲</AppTitle>
                    <AppAction>
                        <Button
                            variant="outline"
                            tooltip="打开大纲文档，卷纲与章纲的原文可直接编辑"
                            onClick={() => openDoc('outline')}
                        >
                            <FileText />
                            打开文档
                        </Button>
                        <OutlineExtractMenu entries={entries} isExtracting={isExtracting} onExtract={handleExtract} />
                        <Button onClick={() => setIsWizardOpen(true)}>
                            <Wand2 />
                            生成大纲
                        </Button>
                    </AppAction>
                    <AppSummary
                        title={workspace.setting.title}
                        path={dirPath}
                        meta={`${workspace.volumes.length} 卷 · ${summary.chapters} 章 · 已完成 ${summary.done} 章`}
                    />
                    <AppMenu>
                        <Progress
                            value={donePercent}
                            className="h-1 min-w-0 flex-1"
                            aria-label={`章节完成度 ${donePercent}%`}
                        />
                        <span className="shrink-0 text-muted-foreground tabular-nums">{donePercent}%</span>
                    </AppMenu>
                </AppHeader>

                <AppContent className="flex px-0">
                    <aside
                        className={cn(
                            'min-h-0 w-full overflow-y-auto px-2 py-2 @2xl:w-64 @2xl:shrink-0 @2xl:border-r @2xl:border-border',
                            hasActiveSelection && 'hidden @2xl:block',
                        )}
                    >
                        <OutlineTree
                            volumes={workspace.volumes}
                            selectedChapterId={selectedChapterId}
                            expandedVolumeIds={expandedVolumeIds}
                            statusFilter={statusFilter}
                            onToggleVolume={handleToggleVolume}
                            onSelectChapter={handleSelectChapter}
                            onFilterChange={setStatusFilter}
                            onCreateVolume={onCreateVolume}
                            onCreateChapter={onCreateChapter}
                        />
                    </aside>

                    <section
                        className={cn(
                            'min-h-0 w-full flex-1 overflow-hidden @2xl:block',
                            !hasActiveSelection && 'hidden @2xl:block',
                        )}
                    >
                        {selectedEntry ? (
                            <OutlineDetail
                                volume={selectedEntry.volume}
                                chapter={selectedEntry.chapter}
                                characters={workspace.characters}
                                prevChapter={
                                    selectedEntry.volume.chapters.find(
                                        (chapter) => chapter.order === selectedEntry.chapter.order - 1,
                                    ) ?? null
                                }
                                nextChapters={selectedEntry.volume.chapters
                                    .filter((chapter) => chapter.order > selectedEntry.chapter.order)
                                    .slice(0, 2)}
                                onChange={(patch) => onUpdateChapter(selectedEntry.chapter.id, patch)}
                                onBack={() => setSelectedChapterId(null)}
                                onOpenChat={onOpenChat}
                                onOpenWizard={() => setIsWizardOpen(true)}
                            />
                        ) : (
                            <StateEmpty
                                icon={ListTree}
                                title="选择一章查看章纲"
                                description="左侧树中点选章节，或先生成一份大纲"
                                className="h-full"
                            />
                        )}
                    </section>

                    {selectedEntry ? (
                        <aside className="hidden min-h-0 w-72 shrink-0 @4xl:flex">
                            <OutlineAiPanel
                                setting={workspace.setting}
                                volume={selectedEntry.volume}
                                chapter={selectedEntry.chapter}
                                characters={workspace.characters}
                                onOpenChat={onOpenChat}
                                onOpenWizard={() => setIsWizardOpen(true)}
                            />
                        </aside>
                    ) : null}
                </AppContent>
            </AppPage>

            {/* key 绑定打开状态：每次重新打开都重建向导，草案与步骤不会从上一次带过来 */}
            <OutlineWizard
                key={isWizardOpen ? 'wizard-open' : 'wizard-closed'}
                isOpen={isWizardOpen}
                onOpenChange={setIsWizardOpen}
                setting={workspace.setting}
                characters={workspace.characters}
                existingChapterCount={summary.chapters}
                defaultChapterWordGoal={defaultChapterWordGoal}
                onApply={onApplyOutline}
            />
        </>
    )
}
