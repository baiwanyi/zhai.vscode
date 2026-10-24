/**
 * 章节正文快照面板：两级卡片视图——先列章节，点某一章进入该章的快照列表，可返回章节列表。
 * 复用约定：取数与动作由 useChapterSnapshots 承担，章节清单由 ChapterList 承担，版本列表由 ChapterVersionList 承担；
 * 两级空态都由业务公共层的 StateEmpty 承担（与「设定与大纲」面板同一组件，仅换文案与图标），容器与标题条取 card；
 * 恢复与删除确认取业务公共层的 ConfirmDialog，创建备注框由 SnapshotCreateDialog 承担。
 * 关键约束：恢复只覆盖当前章，文案须写明覆盖时间点与 dirty 前置条件；该章有未保存修改时由宿主拒绝，此处只如实提示错误。
 */
import { BookOpen, Camera, ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import type { ChapterSnapshotEntry } from '@shared/types/press'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { StateEmpty } from '@webview/components/StateEmpty'
import { ChapterList } from './ChapterList'
import { ChapterVersionList } from './ChapterVersionList'
import { useChapterSnapshots } from './hooks/useChapterSnapshots'
import { SnapshotCreateDialog } from './SnapshotCreateDialog'
import { formatSnapshotTime } from './snapshotFormat'
import type { JSX } from 'react'

interface ChapterSnapshotPanelProps {
    /** 当前作品目录：章节正文副本落在该作品的 Snapshots/Chapters 下 */
    dirPath: string
}

export function ChapterSnapshotPanel({ dirPath }: ChapterSnapshotPanelProps): JSX.Element {
    const { chapters, versions, activeChapterPath, isLoading, isBusy, selectChapter, capture, restore, remove } =
        useChapterSnapshots(dirPath)
    const [pendingRestore, setPendingRestore] = useState<ChapterSnapshotEntry | null>(null)
    const [pendingDelete, setPendingDelete] = useState<ChapterSnapshotEntry | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)

    const activeChapter = chapters.find((item) => item.chapterPath === activeChapterPath) ?? null
    const restoreDescription =
        pendingRestore === null
            ? ''
            : `当前章正文会覆盖为 ${formatSnapshotTime(pendingRestore.createdAt)} 的内容，恢复前会自动留一版当前正文。若该章有未保存的修改，需先保存或撤销。`

    return (
        <>
            {activeChapterPath === null ? (
                <Card className="h-full">
                    <CardHeader>
                        <CardTitle>章节列表</CardTitle>
                        <CardAction>
                            <span className="text-muted-foreground text-xs">
                                {isLoading ? '正在读取…' : `${chapters.length} 章有快照`}
                            </span>
                        </CardAction>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-y-auto">
                        {chapters.length === 0 ? (
                            <StateEmpty
                                isLoading={isLoading}
                                icon={BookOpen}
                                title="还没有章节快照"
                                description="在编辑器里保存章节后会自动留版，AI 写回前也会留底；留过版的章节会出现在这里。"
                                className="h-full border border-dashed border-border"
                            />
                        ) : (
                            <ChapterList
                                chapters={chapters}
                                activeChapterPath={activeChapterPath}
                                onSelect={selectChapter}
                            />
                        )}
                    </CardContent>
                </Card>
            ) : (
                <Card className="h-full">
                    <CardHeader>
                        <CardTitle>快照列表</CardTitle>
                        <CardDescription className="truncate">
                            {activeChapter?.title ?? ''} · 共 {versions.length} 版
                        </CardDescription>
                        <CardAction className="flex items-center gap-1">
                            <Button size="icon" variant="secondary" onClick={() => selectChapter(null)}>
                                <ChevronLeft />
                            </Button>
                            <Button variant="outline" disabled={isBusy} onClick={() => setIsCreateOpen(true)}>
                                <Camera />
                                立即快照
                            </Button>
                        </CardAction>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-y-auto">
                        {versions.length === 0 ? (
                            <StateEmpty
                                icon={BookOpen}
                                title="这一章还没有历史版本"
                                description="保存该章或让 AI 写回一次，就会在这里留下第一版。"
                                className="h-full border border-dashed border-border"
                            />
                        ) : (
                            <ChapterVersionList
                                versions={versions}
                                isBusy={isBusy}
                                onRestore={setPendingRestore}
                                onDelete={setPendingDelete}
                            />
                        )}
                    </CardContent>
                </Card>
            )}

            <ConfirmDialog
                open={pendingRestore !== null}
                title="恢复到这一版？"
                description={restoreDescription}
                confirmLabel="恢复"
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingRestore(null)
                    }
                }}
                onConfirm={() => {
                    const target = pendingRestore
                    setPendingRestore(null)
                    if (target !== null) {
                        void restore(target.id)
                    }
                }}
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title="删除这一版章节快照？"
                description="只删除所选版本，不影响章节正文与其它快照；删除后不可找回。"
                confirmLabel="删除"
                size="sm"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingDelete(null)
                    }
                }}
                onConfirm={() => {
                    const target = pendingDelete
                    setPendingDelete(null)
                    if (target !== null) {
                        void remove(target.id)
                    }
                }}
            />

            <SnapshotCreateDialog
                open={isCreateOpen}
                idPrefix="chapter-snapshot"
                title="立即保存章节快照"
                description="把这一章磁盘上的正文整份存为一版。"
                placeholder="如：改完打斗段落"
                onOpenChange={setIsCreateOpen}
                onSubmit={(label) => {
                    setIsCreateOpen(false)
                    void capture(label)
                }}
            />
        </>
    )
}
