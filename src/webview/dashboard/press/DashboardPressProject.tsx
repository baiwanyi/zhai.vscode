/**
 * 作品详情页（#/press/{作品名}）：页头返回作品列表与作品元信息，主体为卷分组章节目录。
 * 数据与动作经 hooks/usePressProjectDetail 下发，章节渲染与折叠交给 PressChapterList（卷内按批追加），
 * 卷的新建入口位于卷头菜单，卷的重命名/删除与章节的删除由本页承载弹窗，章节移动成功后展开落点卷。
 * 关键约束：详情未就绪时页头用路由中的目录名兜底，避免标题闪烁；新建卷需数据就绪后才可用，
 * 防止向不存在的作品写入；弹窗以被操作的卷重挂载，保证输入框回到当前卷名；页面内屏蔽浏览器右键菜单。
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import type { PressChapterEntry, PressVolumeGroup } from '@/shared/types/press'
import { usePressProjectDetail } from './hooks/usePressProjectDetail'
import { PressChapterDeleteDialog } from './layout/PressChapterDeleteDialog'
import { PressChapterList } from './layout/PressChapterList'
import { PressProjectHeader } from './layout/PressProjectHeader'
import { PressVolumeDeleteDialog } from './layout/PressVolumeDeleteDialog'
import { PressVolumeRenameDialog } from './layout/PressVolumeRenameDialog'
import { formatProjectMeta } from './utils'
import type { JSX } from 'react'
import { useVscodeTheme } from '../hooks/useVscodeTheme'

/** 章节骨架条数：与首屏常见章节数量同量级即可 */
const CHAPTER_PLACEHOLDERS = [0, 1, 2, 3] as const

function PressChapterSkeleton(): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            {CHAPTER_PLACEHOLDERS.map((placeholder) => (
                <Skeleton key={placeholder} className="h-9 w-full rounded-lg" />
            ))}
        </div>
    )
}

interface PressProjectErrorProps {
    message: string | null
    onRetry: () => void
}

function PressProjectError({ message, onRetry }: PressProjectErrorProps): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyTitle>作品读取失败</EmptyTitle>
                <EmptyDescription>{message ?? '请稍后重试'}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button variant="outline" className="rounded-full" onClick={onRetry}>
                    重试
                </Button>
            </EmptyContent>
        </Empty>
    )
}

interface DashboardPressProjectProps {
    /** 相对存储根的作品目录，由详情路由下发 */
    dirPath: string
    /** 返回作品列表 */
    onBack: () => void
}

export function DashboardPressProject({ dirPath, onBack }: DashboardPressProjectProps): JSX.Element {
    const {
        detail,
        status,
        error,
        isCreatingChapter,
        isCreatingVolume,
        isUpdatingVolume,
        isUpdatingChapter,
        reload,
        createChapter,
        createVolume,
        renameVolume,
        deleteVolume,
        deleteChapter,
        moveChapter,
        openChapter,
        openReadme,
    } = usePressProjectDetail(dirPath)
    const theme = useVscodeTheme()
    const [renameTarget, setRenameTarget] = useState<PressVolumeGroup | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<PressVolumeGroup | null>(null)
    const [deleteChapterTarget, setDeleteChapterTarget] = useState<PressChapterEntry | null>(null)
    const [expandVolumeDir, setExpandVolumeDir] = useState<string | undefined>(undefined)
    // 章节移动后递增，让章节列表重挂载并把落点卷作为默认展开项
    const [chapterListKey, setChapterListKey] = useState(0)
    const project = detail?.project
    const fallbackName = dirPath.split('/')[1] ?? '作品'

    const readVolume = (volumeDir: string): PressVolumeGroup | null =>
        detail?.volumes.find((volume) => volume.dirName === volumeDir) ?? null

    const readChapter = (path: string): PressChapterEntry | null => {
        for (const volume of detail?.volumes ?? []) {
            const found = volume.chapters.find((chapter) => chapter.path === path)
            if (found !== undefined) {
                return found
            }
        }
        return null
    }

    const handleConfirmDelete = (volume: PressVolumeGroup): void => {
        void deleteVolume(volume.dirName).then((isSucceeded) => {
            if (isSucceeded) {
                setDeleteTarget(null)
            }
        })
    }

    const handleConfirmDeleteChapter = (chapter: PressChapterEntry): void => {
        void deleteChapter(chapter.path).then((isSucceeded) => {
            if (isSucceeded) {
                setDeleteChapterTarget(null)
            }
        })
    }

    const handleMoveChapter = (path: string, targetVolumeDir: string): void => {
        void moveChapter(path, targetVolumeDir).then((moved) => {
            if (moved !== null) {
                setExpandVolumeDir(targetVolumeDir)
                setChapterListKey((previous) => previous + 1)
            }
        })
    }

    return (
        <div className="flex h-screen flex-col pt-3" onContextMenu={(event) => event.preventDefault()}>
            <div className="flex flex-col gap-2 px-3">
                <PressProjectHeader
                    title={project?.name ?? fallbackName}
                    onBack={onBack}
                    onOpenReadme={() => void openReadme()}
                />
                {project !== undefined ? (
                    <p className="px-1 text-xs text-muted-foreground">{formatProjectMeta(project)}</p>
                ) : null}
            </div>
            <div className="relative min-h-0 flex-1 pt-3">
                <ScrollArea className="h-full">
                    <div className="flex flex-col gap-3 p-3">
                        {status === 'loading' ? <PressChapterSkeleton /> : null}
                        {status === 'error' ? (
                            <PressProjectError message={error} onRetry={() => void reload()} />
                        ) : null}
                        {status === 'ready' ? (
                            <PressChapterList
                                key={chapterListKey}
                                volumes={detail?.volumes ?? []}
                                isCreatingChapter={isCreatingChapter}
                                isCreatingVolume={isCreatingVolume}
                                isUpdatingVolume={isUpdatingVolume}
                                isUpdatingChapter={isUpdatingChapter}
                                initialExpandVolumeDir={expandVolumeDir}
                                onOpenChapter={(path) => void openChapter(path)}
                                onCreateChapter={(volumeDir) => void createChapter(volumeDir)}
                                onCreateVolume={() => void createVolume()}
                                onRenameVolume={(volumeDir) => setRenameTarget(readVolume(volumeDir))}
                                onDeleteVolume={(volumeDir) => setDeleteTarget(readVolume(volumeDir))}
                                onMoveChapter={handleMoveChapter}
                                onDeleteChapter={(path) => setDeleteChapterTarget(readChapter(path))}
                            />
                        ) : null}
                    </div>
                </ScrollArea>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-linear-to-b from-background to-transparent" />
            </div>
            {renameTarget !== null ? (
                <PressVolumeRenameDialog
                    key={renameTarget.dirName}
                    open
                    initialName={renameTarget.name}
                    isSubmitting={isUpdatingVolume}
                    onOpenChange={(open) => {
                        if (!open) {
                            setRenameTarget(null)
                        }
                    }}
                    onSubmit={(name) => renameVolume(renameTarget.dirName, name)}
                />
            ) : null}
            {deleteTarget !== null ? (
                <PressVolumeDeleteDialog
                    open
                    volumeName={deleteTarget.name}
                    chapterCount={deleteTarget.chapters.length}
                    isSubmitting={isUpdatingVolume}
                    onOpenChange={(open) => {
                        if (!open) {
                            setDeleteTarget(null)
                        }
                    }}
                    onConfirm={() => handleConfirmDelete(deleteTarget)}
                />
            ) : null}
            {deleteChapterTarget !== null ? (
                <PressChapterDeleteDialog
                    open
                    chapterTitle={deleteChapterTarget.title}
                    isSubmitting={isUpdatingChapter}
                    onOpenChange={(isOpen) => {
                        if (!isOpen) {
                            setDeleteChapterTarget(null)
                        }
                    }}
                    onConfirm={() => handleConfirmDeleteChapter(deleteChapterTarget)}
                />
            ) : null}
            <Toaster theme={theme} />
        </div>
    )
}
