/**
 * 章纲编辑对话框：全屏 Dialog 内用「章纲编辑 / 写前查纲」两页签承载单章编辑与写作前核对。
 * 复用约定：对话框取 @webview/components/Dialog 并复用其底部确认按钮，页签取 ui/tabs；
 * 编辑表单与聚焦只读区分别拆为 ChapterEditPanel / ChapterFocusPanel 组件，数据由调用方按当前章传入。
 * 关键约束：卷纲只读、章纲只回传补丁；「章纲编辑」只保存章纲，生成引用清单随聚焦面板一同展示；
 * 底部确认随页签切换：编辑页「保存更改」提示已保存后关闭，查纲页「添加到AI对话」即发注入后立即关闭、由宿主切到对话；
 * 正文字数与事实摘要由页头菜单的「写后回填」推导写入，本对话框不提供手动设定；
 * 对话框开合由外部 open/onClose 控制，关闭即重置页签；页签栏与页脚固定，仅 TabsContent 滚动。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Dialog } from '@webview/components/Dialog'
import { ChapterEditPanel } from './ChapterEditPanel'
import { ChapterFocusPanel } from './ChapterFocusPanel'
import type {
    CharacterCard,
    OutlineChapter,
    OutlineChapterRef,
    OutlinePlan,
    OutlineVolume,
    ProjectSetting,
} from '../../types'
import type { JSX } from 'react'
import { chapterTitleLabel } from '../../utils'

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
    plan,
    prevChapter,
    nextChapter,
    nextChapters,
    onChange,
    onAddChapterToChat,
}: ChapterEditDialogProps): JSX.Element {
    const [activeTab, setActiveTab] = useState<ChapterTab>('edit')

    /** 统一关闭：重置页签并通知外部清选中，避免残留状态带到下次打开 */
    const closeDialog = (): void => {
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
                <TabsContent value="edit" className="flex min-h-0 flex-1 items-stretch gap-3 overflow-y-auto">
                    <ChapterEditPanel
                        chapter={chapter}
                        characters={characters}
                        onChange={onChange}
                    />
                </TabsContent>
                <TabsContent value="focus" className="min-h-0 flex-1 overflow-y-auto">
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
