/**
 * 大纲工作台：写作流程的第四步，左侧卷-章树、中间章纲详情、右侧 AI 副驾。
 * 复用约定：三个区域分别由 OutlineTree、OutlineDetail、OutlineAiPanel 承担，本文件负责选中项、
 * 筛选、折叠、向导与提取的编排；步骤条复用 PressFlowSteps，统计口径来自 utils 的 summarizeWorkspace。
 * 关键约束：宽容器用容器查询展开三栏，窄容器（VSCode 侧栏常态）退化为「树 → 详情」下钻，
 * 选中章节后必须隐藏树而不是压缩两栏；折叠状态记录的是「已折叠的卷」，新卷因此默认展开；
 * 提取会用素材重建整棵大纲树，覆盖当前草稿，因此按钮文案与提示都要写明这一点。
 */
import { cn } from 'cn'
import { ListTree, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Progress } from '@components/ui/progress'
import type { PressExtractedVolume } from '@shared/types/press'
import { OutlineAiPanel } from './OutlineAiPanel'
import { OutlineDetail } from './OutlineDetail'
import { OutlineTree } from './OutlineTree'
import { OutlineWizard } from './OutlineWizard'
import { useOutlineExtract } from './useOutlineExtract'
import type { OutlineChapter, OutlineVolume, OutlineWorkspace, PlanStatus } from '../types'
import type { JSX } from 'react'
import { PressFlowSteps } from '../layout/PressFlowSteps'
import { summarizeWorkspace } from '../utils'

interface PressOutlinePageProps {
    workspace: OutlineWorkspace
    /** 当前作品目录：提取大纲读取该作品的 _import 素材 */
    dirPath: string
    defaultChapterWordGoal: number
    onSelectStep: (step: number) => void
    onUpdateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    onCreateVolume: () => void
    onCreateChapter: (volumeId: string) => void
    onApplyOutline: (volumes: OutlineVolume[]) => void
    /** 用素材重建整棵大纲树，返回重建的章节数；父级负责覆盖草稿 */
    onExtractOutline: (drafts: PressExtractedVolume[]) => number
    onOpenChat: () => void
}

export function PressOutlinePage({
    workspace,
    dirPath,
    defaultChapterWordGoal,
    onSelectStep,
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

    const entries = useMemo(
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

    const handleExtract = (): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null) {
                return
            }
            if (result.volumes.length === 0) {
                toast.info(result.message)
                return
            }
            const chapterCount = onExtractOutline(result.volumes)
            // 重建后的卷章 id 全部换新，旧选中项已失效，回到默认的首章
            setSelectedChapterId(null)
            toast.success(`${result.message}，已替换当前大纲（${String(chapterCount)} 章）`)
        }
        void run()
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
                <PressFlowSteps current={4} onSelect={onSelectStep} />
                <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading font-semibold">大纲</h2>
                        <p className="truncate text-muted-foreground tabular-nums">
                            {workspace.volumes.length} 卷 · {summary.chapters} 章 · 已完成 {summary.done} 章
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            title="按已抽取的素材重建卷与章（不调用模型），会覆盖当前大纲草稿"
                            disabled={isExtracting}
                            onClick={handleExtract}
                        >
                            <Sparkles />
                            {isExtracting ? '提取中' : '提取'}
                        </Button>
                        <Button size="sm" onClick={() => setIsWizardOpen(true)}>
                            <Wand2 />
                            生成大纲
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Progress value={donePercent} className="h-1 flex-1" aria-label={`章节完成度 ${donePercent}%`} />
                    <span className="shrink-0 text-muted-foreground tabular-nums">{donePercent}%</span>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
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
                        <Empty className="h-full">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <ListTree />
                                </EmptyMedia>
                                <EmptyTitle>选择一章查看章纲</EmptyTitle>
                                <EmptyDescription>左侧树中点选章节，或先生成一份大纲</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
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
            </div>

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
        </div>
    )
}
