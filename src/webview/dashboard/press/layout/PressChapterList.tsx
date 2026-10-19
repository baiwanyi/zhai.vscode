/**
 * 章节目录：按卷分组渲染可折叠的卷区块，并管理各卷的展开状态。
 * 复用 PressVolumeSection 承载折叠、卷内分批、加章入口与卷级/章节级操作，@components/ui/empty 承载空态。
 * 关键约束：展开状态以「用户操作后的集合」为准，未操作时按默认集合派生（只展开第一个卷，首屏渲染可控）；
 * 在某卷加章前先展开该卷，保证新章节立即可见；移动章节后由父级以 initialExpandVolumeDir + key 重挂载，
 * 让落点卷成为新的默认展开项——不在 effect 里同步改 state，避免多余重渲染；
 * 切换作品由父级以 dirPath 作 key 重挂载来重置状态；卷与章节的操作只向上转发目录名/路径，
 * 具体交互与请求由页面层承担；「新建卷」入口位于卷头菜单，作品还没有卷时由空态按钮兜底，避免无入口可点。
 */
import { BookPlus, FileText } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { PressVolumeGroup } from '@shared/types/press'
import { PressVolumeSection } from './PressVolumeSection'
import type { JSX } from 'react'

interface PressChapterListProps {
    volumes: PressVolumeGroup[]
    isCreatingChapter: boolean
    /** 新建卷进行中：卷头菜单与空态按钮共用禁用态 */
    isCreatingVolume: boolean
    /** 卷级操作进行中：透传给卷区块以禁用入口 */
    isUpdatingVolume: boolean
    /** 章节级操作进行中：透传给卷区块以禁用章节入口 */
    isUpdatingChapter: boolean
    /** 挂载时默认展开的卷：章节移动后由父级下发落点卷目录名，并配合 key 重挂载生效 */
    initialExpandVolumeDir?: string
    onOpenChapter: (path: string) => void
    onCreateChapter: (volumeDir: string) => void
    onCreateVolume: () => void
    onRenameVolume: (volumeDir: string) => void
    onDeleteVolume: (volumeDir: string) => void
    onMoveChapter: (path: string, targetVolumeDir: string) => void
    onDeleteChapter: (path: string) => void
}

export function PressChapterList({
    volumes,
    isCreatingChapter,
    isCreatingVolume,
    isUpdatingVolume,
    isUpdatingChapter,
    initialExpandVolumeDir,
    onOpenChapter,
    onCreateChapter,
    onCreateVolume,
    onRenameVolume,
    onDeleteVolume,
    onMoveChapter,
    onDeleteChapter,
}: PressChapterListProps): JSX.Element {
    // 默认只展开第一个卷：长篇作品首屏最多渲染一批章节，其余按需展开；
    // 章节移动后由 initialExpandVolumeDir 指定落点卷优先展开
    const defaultExpanded = useMemo(() => {
        const next = new Set<string>()
        if (initialExpandVolumeDir !== undefined) {
            next.add(initialExpandVolumeDir)
        }
        const first = volumes[0]
        if (first !== undefined) {
            next.add(first.dirName)
        }
        return next
    }, [initialExpandVolumeDir, volumes])
    const [userExpanded, setUserExpanded] = useState<ReadonlySet<string> | null>(null)
    const expanded = userExpanded ?? defaultExpanded

    const handleOpenChange = useCallback(
        (volumeDir: string, isOpen: boolean): void => {
            setUserExpanded((previous) => {
                const next = new Set(previous ?? defaultExpanded)
                if (isOpen) {
                    next.add(volumeDir)
                } else {
                    next.delete(volumeDir)
                }
                return next
            })
        },
        [defaultExpanded],
    )

    const handleCreateChapter = useCallback(
        (volumeDir: string): void => {
            setUserExpanded((previous) => {
                const next = new Set(previous ?? defaultExpanded)
                next.add(volumeDir)
                return next
            })
            onCreateChapter(volumeDir)
        },
        [defaultExpanded, onCreateChapter],
    )

    if (volumes.length === 0) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <FileText />
                    </EmptyMedia>
                    <EmptyTitle>还没有章节</EmptyTitle>
                    <EmptyDescription>
                        点击「新建卷」创建第一卷并写入首章，或在 Chapter/ 对应卷目录下新建文档后保存。
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    <Button
                        variant="outline"
                        className="rounded-full"
                        disabled={isCreatingVolume}
                        onClick={onCreateVolume}
                    >
                        <BookPlus data-icon="inline-start" />
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
                    isOpen={expanded.has(volume.dirName)}
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
