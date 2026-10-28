/**
 * 作品详情页（#/press/{作品名}）：页头返回作品列表与作品元信息，主体为卷分组章节目录，底部为作品级操作入口。
 * 复用约定：外壳取 components/AppPage（页头走 AppHeader、章节目录走 AppContent 滚动、素材抽取与删除作品走 AppFooter
 * 并交给 PressProjectFooterActions、弹窗挂在骨架外）；数据动作经 hooks 下发，加载与失败态由 PressChapterList 自行分派。
 * 关键约束：详情未就绪时页头用路由中的目录名兜底，避免标题闪烁；素材抽取需数据就绪，删除作品期间不可重复触发；
 * 卷展开由本页单值 openVolumeDir 受控，卷之间互斥；底部「添加章节」写入当前展开的卷、全部收起时回落第一个卷；
 * 四个弹窗收敛为一个判别联合状态（open 类动作进入、close 退出），避免多个可空/布尔状态并存出现非法组合；
 * 弹窗以被操作的卷重挂载，保证输入框回到当前卷名；章节移动成功后递增列表 key 重挂载并展开落点卷；
 * 素材抽取只做本地统计（AI 生成由工作台各页面触发）；摘要回填只补空、不覆盖章节里已有的 summary；
 * 删除作品成功后跳回列表，页面内屏蔽浏览器右键菜单。
 */
import { ChevronLeft } from 'lucide-react'
import { useCallback, useMemo, useReducer, useState } from 'react'
import type { PressChapterEntry, PressVolumeGroup } from '@shared/types/press'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { usePressAnalyze } from './hooks/usePressAnalyze'
import { usePressProjectDetail } from './hooks/usePressProjectDetail'
import { PressChapterDeleteDialog } from './layout/PressChapterDeleteDialog'
import { PressChapterList } from './layout/PressChapterList'
import { PressProjectDeleteDialog } from './layout/PressProjectDeleteDialog'
import { PressProjectFooterActions } from './layout/PressProjectFooterActions'
import { PressVolumeDeleteDialog } from './layout/PressVolumeDeleteDialog'
import { PressVolumeRenameDialog } from './layout/PressVolumeRenameDialog'
import { formatProjectMeta } from './utils'
import type { JSX } from 'react'

/** 空卷集合常量：详情未就绪时复用同一引用，避免下游回调依赖抖动 */
const EMPTY_VOLUMES: PressVolumeGroup[] = []

/** 页面弹窗：同一时刻只允许一个，用判别联合替代多组可空状态 */
type ProjectDialog =
    | { kind: 'none' }
    | { kind: 'renameVolume'; volume: PressVolumeGroup }
    | { kind: 'deleteVolume'; volume: PressVolumeGroup }
    | { kind: 'deleteChapter'; chapter: PressChapterEntry }
    | { kind: 'deleteProject' }

type ProjectDialogAction =
    | { type: 'renameVolume'; volume: PressVolumeGroup }
    | { type: 'deleteVolume'; volume: PressVolumeGroup }
    | { type: 'deleteChapter'; chapter: PressChapterEntry }
    | { type: 'deleteProject' }
    | { type: 'close' }

const INITIAL_DIALOG: ProjectDialog = { kind: 'none' }

function projectDialogReducer(state: ProjectDialog, action: ProjectDialogAction): ProjectDialog {
    switch (action.type) {
        case 'renameVolume':
            return { kind: 'renameVolume', volume: action.volume }
        case 'deleteVolume':
            return { kind: 'deleteVolume', volume: action.volume }
        case 'deleteChapter':
            return { kind: 'deleteChapter', chapter: action.chapter }
        case 'deleteProject':
            return { kind: 'deleteProject' }
        case 'close':
            return INITIAL_DIALOG
        default:
            return state
    }
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
        isDeletingProject,
        reload,
        createChapter,
        createVolume,
        renameVolume,
        deleteVolume,
        deleteChapter,
        deleteProject,
        moveChapter,
        openChapter,
        isMergingSummary,
        mergeChapterSummary,
    } = usePressProjectDetail(dirPath)
    const { isAnalyzing, analyze } = usePressAnalyze(dirPath)
    const [dialog, dispatchDialog] = useReducer(projectDialogReducer, INITIAL_DIALOG)
    /** 章节列表重挂载计数：章节移动后递增，重置卷内分批与展开现场 */
    const [listRevision, setListRevision] = useState(0)
    /** 当前展开的卷：undefined 表示用户尚未操作（跟随第一个卷），null 表示已全部收起 */
    const [openVolumeDir, setOpenVolumeDir] = useState<string | null>()

    const volumes = useMemo(() => detail?.volumes ?? EMPTY_VOLUMES, [detail])
    /** 实际展开的卷：未操作时默认第一个卷，既保证首屏有内容，也让添加章节有明确落点 */
    const expandedVolumeDir = openVolumeDir === undefined ? (volumes[0]?.dirName ?? null) : openVolumeDir
    const project = detail?.project
    const fallbackName = dirPath.split('/')[1] ?? '作品'
    const projectName = project?.name ?? fallbackName
    const chapterCount = useMemo(() => volumes.reduce((sum, volume) => sum + volume.chapters.length, 0), [volumes])

    const closeDialog = useCallback((): void => dispatchDialog({ type: 'close' }), [])

    const handleDialogOpenChange = useCallback(
        (open: boolean): void => {
            if (!open) {
                closeDialog()
            }
        },
        [closeDialog],
    )

    const handleRenameVolume = useCallback(
        (volumeDir: string): void => {
            const volume = volumes.find((item) => item.dirName === volumeDir)
            if (volume !== undefined) {
                dispatchDialog({ type: 'renameVolume', volume })
            }
        },
        [volumes],
    )

    const handleAskDeleteVolume = useCallback(
        (volumeDir: string): void => {
            const volume = volumes.find((item) => item.dirName === volumeDir)
            if (volume !== undefined) {
                dispatchDialog({ type: 'deleteVolume', volume })
            }
        },
        [volumes],
    )

    const handleAskDeleteChapter = useCallback(
        (path: string): void => {
            const chapter = volumes.flatMap((volume) => volume.chapters).find((item) => item.path === path)
            if (chapter !== undefined) {
                dispatchDialog({ type: 'deleteChapter', chapter })
            }
        },
        [volumes],
    )

    const handleConfirmDeleteVolume = useCallback(
        (volume: PressVolumeGroup): void => {
            void deleteVolume(volume.dirName).then((isSucceeded) => {
                if (isSucceeded) {
                    closeDialog()
                }
            })
        },
        [closeDialog, deleteVolume],
    )

    const handleConfirmDeleteChapter = useCallback(
        (chapter: PressChapterEntry): void => {
            void deleteChapter(chapter.path).then((isSucceeded) => {
                if (isSucceeded) {
                    closeDialog()
                }
            })
        },
        [closeDialog, deleteChapter],
    )

    /** 删除整部作品：成功后关闭弹窗并跳回作品列表，结果提示由数据层经 sonner 给出 */
    const handleConfirmDeleteProject = useCallback((): void => {
        void deleteProject().then((isSucceeded) => {
            if (isSucceeded) {
                closeDialog()
                onBack()
            }
        })
    }, [closeDialog, deleteProject, onBack])

    const handleMoveChapter = useCallback(
        (path: string, targetVolumeDir: string): void => {
            void moveChapter(path, targetVolumeDir).then((moved) => {
                if (moved !== null) {
                    setOpenVolumeDir(targetVolumeDir)
                    setListRevision((previous) => previous + 1)
                }
            })
        },
        [moveChapter],
    )

    /**
     * 添加章节：展开的卷可追加时写入该卷；
     * 全部收起（或展开的是未分卷组）时不指定卷，由数据层落到序号最大的卷，作品还没有卷时自动创建默认卷。
     */
    const handleAddChapter = useCallback((): void => {
        const isOpenAppendable = expandedVolumeDir !== null && expandedVolumeDir.length > 0
        if (isOpenAppendable) {
            void createChapter(expandedVolumeDir)
            return
        }
        void createChapter()
    }, [createChapter, expandedVolumeDir])

    return (
        <>
            <AppPage onContextMenu={(event) => event.preventDefault()}>
                <AppHeader align="start">
                    <AppTitle tooltip={projectName}>{projectName}</AppTitle>
                    <AppAction>
                        <Button
                            variant="secondary"
                            size="icon"
                            aria-label="返回作品列表"
                            tooltip="返回作品列表"
                            onClick={onBack}
                        >
                            <ChevronLeft />
                        </Button>
                    </AppAction>
                    {project !== undefined && <AppDescription>{formatProjectMeta(project)}</AppDescription>}
                </AppHeader>
                <AppContent isScrollable>
                    <PressChapterList
                        key={listRevision}
                        status={status}
                        error={error}
                        onRetry={() => void reload()}
                        volumes={volumes}
                        isCreatingChapter={isCreatingChapter}
                        isCreatingVolume={isCreatingVolume}
                        isUpdatingVolume={isUpdatingVolume}
                        isUpdatingChapter={isUpdatingChapter}
                        openVolumeDir={expandedVolumeDir}
                        onOpenVolume={setOpenVolumeDir}
                        onOpenChapter={(path) => void openChapter(path)}
                        onCreateChapter={(volumeDir) => void createChapter(volumeDir)}
                        onCreateVolume={() => void createVolume()}
                        onRenameVolume={handleRenameVolume}
                        onDeleteVolume={handleAskDeleteVolume}
                        onMoveChapter={handleMoveChapter}
                        onDeleteChapter={handleAskDeleteChapter}
                    />
                </AppContent>
                <AppFooter>
                    <PressProjectFooterActions
                        isAnalyzing={isAnalyzing}
                        isMergingSummary={isMergingSummary}
                        isCreatingChapter={isCreatingChapter}
                        isDeletingProject={isDeletingProject}
                        isReady={status === 'ready'}
                        onAddChapter={handleAddChapter}
                        onAnalyze={() => void analyze()}
                        onMergeSummary={() => void mergeChapterSummary()}
                        onDelete={() => dispatchDialog({ type: 'deleteProject' })}
                    />
                </AppFooter>
            </AppPage>

            {dialog.kind === 'renameVolume' && (
                <PressVolumeRenameDialog
                    key={dialog.volume.dirName}
                    open
                    initialName={dialog.volume.name}
                    isSubmitting={isUpdatingVolume}
                    onOpenChange={handleDialogOpenChange}
                    onSubmit={(name) => renameVolume(dialog.volume.dirName, name)}
                />
            )}

            {dialog.kind === 'deleteVolume' && (
                <PressVolumeDeleteDialog
                    open
                    volumeName={dialog.volume.name}
                    chapterCount={dialog.volume.chapters.length}
                    isSubmitting={isUpdatingVolume}
                    onOpenChange={handleDialogOpenChange}
                    onConfirm={() => handleConfirmDeleteVolume(dialog.volume)}
                />
            )}

            {dialog.kind === 'deleteChapter' && (
                <PressChapterDeleteDialog
                    open
                    chapterTitle={dialog.chapter.title}
                    isSubmitting={isUpdatingChapter}
                    onOpenChange={handleDialogOpenChange}
                    onConfirm={() => handleConfirmDeleteChapter(dialog.chapter)}
                />
            )}

            {dialog.kind === 'deleteProject' && (
                <PressProjectDeleteDialog
                    open
                    projectName={projectName}
                    volumeCount={volumes.length}
                    chapterCount={chapterCount}
                    isSubmitting={isDeletingProject}
                    onOpenChange={handleDialogOpenChange}
                    onConfirm={handleConfirmDeleteProject}
                />
            )}
        </>
    )
}
