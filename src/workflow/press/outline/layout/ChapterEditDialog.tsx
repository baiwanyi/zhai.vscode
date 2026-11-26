/**
 * 章纲编辑对话框：全屏 Dialog 内用「章纲编辑 / 写前查纲」两页签承载单章编辑与写作前核对。
 * 复用约定：对话框取 @webview/components/Dialog 并复用其底部确认按钮，页签取 ui/tabs；
 * 编辑表单与聚焦只读区分别拆为 ChapterEditPanel / ChapterFocusPanel 组件，数据由调用方按当前章传入。
 * 关键约束：卷纲只读、章纲只回传补丁；「章纲编辑」只保存章纲，生成引用清单随聚焦面板一同展示；
 * 底部确认随页签切换：编辑页「保存更改」提示已保存后关闭，查纲页「添加到AI对话」即发注入后立即关闭、由宿主切到对话；
 * 正文字数与事实摘要由页头菜单的「写后回填」推导写入，本对话框不提供手动设定；
 * 对话框开合由外部 open/onClose 控制，关闭即重置页签；页签栏与页脚固定，仅 TabsContent 滚动。
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Dialog } from '@webview/components/Dialog'
import { ChapterEditPanel } from './ChapterEditPanel'
import { ChapterFocusPanel } from './ChapterFocusPanel'
import type {
    CharacterCard,
    LoreEntry,
    OutlineChapter,
    OutlineChapterRef,
    OutlinePlan,
    OutlineVolume,
    ProjectSetting,
} from '../../types'
import type { JSX } from 'react'
import { DEFAULT_CHAPTER_WORD_GOAL } from '../../constants'
import { chapterTitleLabel } from '../../utils'
import { useChapterSummaryGenerate } from '../hooks/useChapterSummaryGenerate'

interface ChapterEditDialogProps {
    /** 对话框开合：由外部选中状态决定 */
    open: boolean
    /** 关闭对话框：只通知外部清选中，不改数据 */
    onClose: () => void
    setting: ProjectSetting
    volume: OutlineVolume
    chapter: OutlineChapter
    chapterRef: OutlineChapterRef
    characters: CharacterCard[]
    /** 设定页地点条目：供章纲卡的场景地点选取 */
    lore: readonly LoreEntry[]
    plan: OutlinePlan
    /** 同卷上一章，用于「前情」提示 */
    prevChapter: OutlineChapter | null
    /** 同卷下一章，用于聚焦视图的「接下来」提示 */
    nextChapter: OutlineChapter | null
    /** 同卷后续两章，用于聚焦视图卷纲区的「接下来」提示 */
    nextChapters: OutlineChapter[]
    onChange: (patch: Partial<OutlineChapter>) => void
    /** 把当前章大纲作为上下文注入 AI 对话，由对话完成正文生成 */
    onAddChapterToChat: () => Promise<void>
}

type ChapterTab = 'edit' | 'focus'

export function ChapterEditDialog({
    open,
    onClose,
    setting,
    volume,
    chapter,
    chapterRef,
    characters,
    lore,
    plan,
    prevChapter,
    nextChapter,
    nextChapters,
    onChange,
    onAddChapterToChat,
}: ChapterEditDialogProps): JSX.Element {
    const [activeTab, setActiveTab] = useState<ChapterTab>('edit')
    const chapterWordGoal = setting.chapterWordGoal > 0 ? setting.chapterWordGoal : DEFAULT_CHAPTER_WORD_GOAL
    const { isGenerating, generate } = useChapterSummaryGenerate()
    /** 生成开始时锁定梗概快照：等待期间用户改过就不让结果覆盖，避免 AI 抢答吞掉输入 */
    const summaryAtGenerateRef = useRef<string | null>(null)
    const summaryRef = useRef(chapter.summary)
    /** 关闭后吞掉在途生成结果，避免退出编辑仍回写数据 */
    const isActiveRef = useRef(true)
    useEffect((): void => {
        summaryRef.current = chapter.summary
    }, [chapter.summary])

    const handleGenerateSummary = (): void => {
        summaryAtGenerateRef.current = chapter.summary
        summaryRef.current = chapter.summary
        void generate({
            chapter,
            volume,
            chapterRef,
            setting,
            characters,
            plan,
            prevChapter,
        }).then((content) => {
            if (!isActiveRef.current) {
                return
            }
            if (content === null || summaryAtGenerateRef.current === null) {
                return
            }
            if (summaryRef.current !== summaryAtGenerateRef.current) {
                toast.info('AI 内容已生成，但你在等待期间修改了梗概，已保留手写内容')
                return
            }
            onChange({ summary: content })
        })
    }

    /** 统一关闭：重置页签并通知外部清选中，避免残留状态带到下次打开 */
    const closeDialog = (): void => {
        isActiveRef.current = false
        setActiveTab('edit')
        onClose()
    }

    /** 底部确认：查纲页即发注入后立即关闭，由宿主切到对话分区；编辑页提示后关闭 */
    const handleConfirm = (): void => {
        if (activeTab === 'focus') {
            void onAddChapterToChat()
        } else {
            toast.success('章纲已保存')
        }
        closeDialog()
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    closeDialog()
                }
            }}
            title={`编辑「${chapterTitleLabel(chapter)}」章纲`}
            onConfirm={handleConfirm}
            confirmLabel={activeTab === 'edit' ? '保存更改' : '添加到 AI 对话'}
            isDisabled={isGenerating}
            isContentScrollable={false}
            size="full"
        >
            <Tabs
                value={activeTab}
                onValueChange={(value) => {
                    if (value === 'edit' || value === 'focus') {
                        setActiveTab(value)
                    }
                }}
                className="flex h-full min-h-0 flex-col"
            >
                <TabsList className="w-full shrink-0">
                    <TabsTrigger value="edit">章纲编辑</TabsTrigger>
                    <TabsTrigger value="focus">写前查纲</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                    <ChapterEditPanel
                        chapter={chapter}
                        characters={characters}
                        lore={lore}
                        chapterWordGoal={chapterWordGoal}
                        stageNames={plan.acts.map((act) => act.name)}
                        summaryGeneration={{ isGenerating, onGenerate: handleGenerateSummary }}
                        onChange={onChange}
                    />
                </TabsContent>
                <TabsContent value="focus" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                    <ChapterFocusPanel
                        setting={setting}
                        volume={volume}
                        chapter={chapter}
                        chapterRef={chapterRef}
                        characters={characters}
                        plan={plan}
                        prevChapter={prevChapter}
                        nextChapter={nextChapter}
                        nextChapters={nextChapters}
                    />
                </TabsContent>
            </Tabs>
        </Dialog>
    )
}
