/**
 * 章节目录：按加载状态分派（加载骨架、失败重试、有数据渲染卷分组），并按卷分组渲染可折叠的卷区块。
 * 复用 PressVolumeSection 承载折叠、卷内分批、加章入口与卷级/章节级操作，PressStateViews 承载骨架与失败块，
 * @components/ui/empty 承载空态；状态分派与作品列表保持同一套写法。
 * 关键约束：展开状态由父级以「当前展开的卷目录」单值受控，本组件不持有展开 state，故卷之间天然互斥；
 * 在某卷加章前先通过 onOpenVolume 展开该卷，保证新章节立即可见；卷与章节的操作只向上转发目录名/路径，
 * 具体交互与请求由页面层承担；「新建卷」入口位于卷头菜单，作品还没有卷时由空态按钮兜底，避免无入口可点。
 */
import { BookPlus, FileText } from 'lucide-react'
import { useCallback } from 'react'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { PressVolumeGroup } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { PressErrorState, PressSkeletonList } from './PressStateViews'
import { PressVolumeSection } from './PressVolumeSection'
import type { PressStatus } from '../utils'
import type { JSX } from 'react'

interface PressChapterListProps {
    /** 数据加载状态：loading / error 时本组件自行渲染骨架与失败块 */
    status: PressStatus
    /** 失败原因：缺失时由 PressErrorState 回落到通用文案 */
    error: string | null
    /** 失败重试：由页面层下发数据层 reload */
    onRetry: () => void
    volumes: PressVolumeGroup[]
    isCreatingChapter: boolean
    /** 新建卷进行中：卷头菜单与空态按钮共用禁用态 */
    isCreatingVolume: boolean
    /** 卷级操作进行中：透传给卷区块以禁用入口 */
    isUpdatingVolume: boolean
    /** 章节级操作进行中：透传给卷区块以禁用章节入口 */
    isUpdatingChapter: boolean
    /** 当前展开的卷目录；null 表示全部收起，由父级单值状态保证卷之间互斥 */
    openVolumeDir: string | null
    /** 展开/收起卷：展开传目录名、收起传 null */
    onOpenVolume: (volumeDir: string | null) => void
    onOpenChapter: (path: string) => void
    onCreateChapter: (volumeDir: string) => void
    onCreateVolume: () => void
    onRenameVolume: (volumeDir: string) => void
    onDeleteVolume: (volumeDir: string) => void
    onMoveChapter: (path: string, targetVolumeDir: string) => void
    onDeleteChapter: (path: string) => void
}

export function PressChapterList({
    status,
    error,
    onRetry,
    volumes,
    isCreatingChapter,
    isCreatingVolume,
    isUpdatingVolume,
    isUpdatingChapter,
    openVolumeDir,
    onOpenVolume,
    onOpenChapter,
    onCreateChapter,
    onCreateVolume,
    onRenameVolume,
    onDeleteVolume,
    onMoveChapter,
    onDeleteChapter,
}: PressChapterListProps): JSX.Element {
    const handleOpenChange = useCallback(
        (volumeDir: string, isOpen: boolean): void => {
            onOpenVolume(isOpen ? volumeDir : null)
        },
        [onOpenVolume],
    )

    const handleCreateChapter = useCallback(
        (volumeDir: string): void => {
            onOpenVolume(volumeDir)
            onCreateChapter(volumeDir)
        },
        [onCreateChapter, onOpenVolume],
    )

    if (status === 'loading') {
        return <PressSkeletonList count={4} itemClassName="h-9 rounded-lg" />
    }

    if (status === 'error') {
        return <PressErrorState title="作品读取失败" message={error} onRetry={onRetry} />
    }

    if (volumes.length === 0) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <FileText />
                    </EmptyMedia>
                    <EmptyTitle>还没有章节</EmptyTitle>
                    <EmptyDescription>
                        点击「新建卷」创建第一卷并写入首章，或在 Chapters/ 对应卷目录下新建文档后保存。
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    <Button
                        variant="outline"
                        className="rounded-full"
                        disabled={isCreatingVolume}
                        onClick={onCreateVolume}
                    >
                        <BookPlus />
                        新建卷
                    </Button>
                </EmptyContent>
            </Empty>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {volumes.map((volume) => (
                <PressVolumeSection
                    key={volume.dirName}
                    volume={volume}
                    isOpen={openVolumeDir === volume.dirName}
                    canAppend={volume.dirName.length > 0}
                    isCreatingChapter={isCreatingChapter}
                    isCreatingVolume={isCreatingVolume}
                    isUpdatingVolume={isUpdatingVolume}
                    isUpdatingChapter={isUpdatingChapter}
                    moveTargets={volumes.filter((item) => item.dirName !== volume.dirName)}
                    onOpenChange={handleOpenChange}
                    onOpenChapter={onOpenChapter}
                    onCreateChapter={handleCreateChapter}
                    onCreateVolume={onCreateVolume}
                    onRenameVolume={onRenameVolume}
                    onDeleteVolume={onDeleteVolume}
                    onMoveChapter={onMoveChapter}
                    onDeleteChapter={onDeleteChapter}
                />
            ))}
        </div>
    )
}
