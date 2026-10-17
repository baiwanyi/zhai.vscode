/**
 * 章节目录：按卷分组渲染可折叠的卷区块，并管理各卷的展开状态。
 * 复用 PressVolumeSection 承载折叠、卷内分批与加章入口，@/components/ui/empty 承载空态。
 * 关键约束：展开状态以「用户操作后的集合」为准，未操作时按默认集合派生（只展开第一个卷，首屏渲染可控）；
 * 在某卷加章前先展开该卷，保证新章节立即可见；切换作品由父级以 dirPath 作 key 重挂载来重置状态。
 */
import { FileText } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { PressVolumeGroup } from '@/shared/types/press'
import { PressVolumeSection } from './PressVolumeSection'
import type { JSX } from 'react'

interface PressChapterListProps {
    volumes: PressVolumeGroup[]
    isCreatingChapter: boolean
    onOpenChapter: (path: string) => void
    onCreateChapter: (volumeDir: string) => void
}

export function PressChapterList({
    volumes,
    isCreatingChapter,
    onOpenChapter,
    onCreateChapter,
}: PressChapterListProps): JSX.Element {
    // 默认只展开第一个卷：长篇作品首屏最多渲染一批章节，其余按需展开
    const defaultExpanded = useMemo(() => {
        const first = volumes[0]
        return new Set<string>(first === undefined ? [] : [first.dirName])
    }, [volumes])
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
                    onOpenChange={handleOpenChange}
                    onOpenChapter={onOpenChapter}
                    onCreateChapter={handleCreateChapter}
                />
            ))}
        </div>
    )
}
