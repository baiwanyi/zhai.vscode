/**
 * 取名结果弹窗：以弹层展示当前分类的一批候选，含数量摘要、复制全部与空态引导，关闭后可从页面底部「查看结果」再开。
 * 复用约定：弹层复用 ui/dialog（含无障碍标题与描述），空态复用 ui/empty，候选卡片复用同目录 NamingResultCard，
 * 滚动复用 ui/scroll-area，等待态复用 ui/spinner；复制与失败提示统一走 sonner，弹窗内不渲染内联错误。
 * 关键约束：结果由父级按分类缓存，本组件不持有生成状态；关闭弹窗不影响进行中的生成，
 * 首次生成（列表为空）时显示等待态而非空态；生成过程只能在页面底部操作区中断，弹窗不提供取消入口。
 */
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { ScrollArea } from '@components/ui/scroll-area'
import { Spinner } from '@components/ui/spinner'
import type { NamingCandidate } from '@shared/types/naming'
import { NamingResultCard } from './NamingResultCard'
import type { JSX } from 'react'
import { EMPTY_DESCRIPTION, EMPTY_TITLE } from '../constants'
import { copyName, joinNames } from '../utils'

interface NamingResultDialogProps {
    open: boolean
    /** 分类文案：用于弹窗描述，说明当前展示的是哪个分类的结果 */
    categoryLabel: string
    items: NamingCandidate[]
    isGenerating: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function NamingResultDialog({
    open,
    categoryLabel,
    items,
    isGenerating,
    onOpenChange,
}: NamingResultDialogProps): JSX.Element {
    const handleCopyAll = async (): Promise<void> => {
        const isSuccess = await copyName(joinNames(items))
        if (isSuccess) {
            toast.success(`已复制 ${items.length} 个名字`)
            return
        }
        toast.error('复制失败，请手动选中后复制')
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-lg">取名结果</DialogTitle>
                    <DialogDescription>
                        {isGenerating ? '正在生成新一批候选…' : `${categoryLabel} · 关闭后可从底部「查看结果」再次打开`}
                    </DialogDescription>
                </DialogHeader>
                {isGenerating && items.length === 0 ? (
                    <p className="text-muted-foreground flex min-h-40 items-center justify-center gap-2">
                        <Spinner />
                        正在生成名字…
                    </p>
                ) : (
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="flex h-full flex-col gap-2">
                            <div className="flex min-h-6 items-center justify-between gap-2">
                                <p className="text-muted-foreground">
                                    {items.length > 0 ? `已生成 ${items.length} 个名字` : '结果'}
                                </p>
                            </div>
                            {items.length === 0 ? (
                                <Empty className="min-h-40">
                                    <EmptyHeader>
                                        <EmptyMedia variant="icon">
                                            <Sparkles />
                                        </EmptyMedia>
                                        <EmptyTitle>{EMPTY_TITLE}</EmptyTitle>
                                        <EmptyDescription>{EMPTY_DESCRIPTION}</EmptyDescription>
                                    </EmptyHeader>
                                </Empty>
                            ) : (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                                    {items.map((candidate) => (
                                        <NamingResultCard key={candidate.id} candidate={candidate} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        关闭
                    </Button>
                    {items.length > 0 ? <Button onClick={() => void handleCopyAll()}>复制全部</Button> : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
