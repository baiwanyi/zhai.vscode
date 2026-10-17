/**
 * 作品详情页（#/press/{作品名}）：页头返回作品列表、作品元信息、新建卷入口与卷分组章节目录。
 * 数据与动作经 hooks/usePressProjectDetail 下发，章节渲染与折叠交给 PressChapterList（卷内按批追加）。
 * 关键约束：详情未就绪时页头用路由中的目录名兜底，避免标题闪烁；「新建卷」仅在数据就绪后可用，
 * 防止向不存在的作品写入；页面内屏蔽浏览器右键菜单，与仪表盘其余页面一致。
 */
import { BookPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { usePressProjectDetail } from './hooks/usePressProjectDetail'
import { PressChapterList } from './layout/PressChapterList'
import { PressProjectHeader } from './layout/PressProjectHeader'
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
        reload,
        createChapter,
        createVolume,
        openChapter,
        openReadme,
    } = usePressProjectDetail(dirPath)
    const theme = useVscodeTheme()
    const project = detail?.project
    const fallbackName = dirPath.split('/')[1] ?? '作品'

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
                <Button
                    variant="outline"
                    size="lg"
                    className="w-full justify-start rounded-full"
                    disabled={isCreatingVolume || status !== 'ready'}
                    onClick={() => void createVolume()}
                >
                    <BookPlus data-icon="inline-start" />
                    新建卷
                </Button>
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
                                volumes={detail?.volumes ?? []}
                                isCreatingChapter={isCreatingChapter}
                                onOpenChapter={(path) => void openChapter(path)}
                                onCreateChapter={(volumeDir) => void createChapter(volumeDir)}
                            />
                        ) : null}
                    </div>
                </ScrollArea>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-linear-to-b from-background to-transparent" />
            </div>
            <Toaster theme={theme} />
        </div>
    )
}
