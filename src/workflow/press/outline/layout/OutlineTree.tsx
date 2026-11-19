/**
 * 大纲章节列表：把全部章节摊平成一列，卷归属由页头下拉筛选，不再按卷分组。
 * 复用约定：章节行复用 components/Button 的 ghost 变体，状态点取 PLAN_STATUS_META 的语义底色，
 * 空态复用 components/StateEmpty，标题与字数取自 utils 的 chapterTitleLabel / formatWordCount。
 * 关键约束：本组件只读——新增卷与章节的入口在页头动作区的「新增」菜单，这里不重复提供；
 * 行内只放「状态点 + 章节序号 + 标题（左对齐）+ 已写字数」，不显示卷名、不展示梗概；
 * 卷筛选在页面完成，本组件只按 statusFilter 过滤；状态与卷名仍进 aria-label，
 * 序号跨卷会重复，读屏需要卷名才能区分。
 */
import { cn } from 'cn'
import { ScrollText } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { OutlineTreeEntry, PlanStatus } from '../../types'
import type { JSX } from 'react'
import { PLAN_STATUS_META } from '../../constants'
import { chapterTitleLabel, formatWordCount } from '../../utils'

interface OutlineTreeProps {
    /** 已按卷筛选的扁平章节，数组顺序即全局章序 */
    entries: readonly OutlineTreeEntry[]
    selectedChapterId: string | null
    /** 状态筛选值：由页面顶部下拉控制，本组件只负责过滤 */
    statusFilter: PlanStatus | 'all'
    /** 全量是否有章节：区分「作品还没有大纲」与「筛选后为空」 */
    hasAnyChapter: boolean
    /** 列表是否叠加了卷筛选或标题搜索：筛空时文案要说「没有符合筛选」 */
    isListFiltered: boolean
    onSelectChapter: (chapterId: string) => void
}

export function OutlineTree({
    entries,
    selectedChapterId,
    statusFilter,
    hasAnyChapter,
    isListFiltered,
    onSelectChapter,
}: OutlineTreeProps): JSX.Element {
    const visibleEntries = entries.filter((entry) => statusFilter === 'all' || entry.chapter.status === statusFilter)
    // 只有作品本身没有章节才是「还没有大纲」；筛选或搜索筛空不能冒充空作品
    const isEmptyText = isListFiltered || statusFilter !== 'all' ? '没有符合筛选的章节' : '还没有章节'

    return (
        <>
            {hasAnyChapter ? (
                <div className="flex flex-col gap-0.5">
                    {visibleEntries.length === 0 ? (
                        <p className="px-2 py-1 text-muted-foreground">{isEmptyText}</p>
                    ) : (
                        visibleEntries.map((entry) => {
                            const meta = PLAN_STATUS_META[entry.chapter.status]
                            const isSelected = entry.chapter.id === selectedChapterId
                            return (
                                <Button
                                    key={entry.chapter.id}
                                    variant="ghost"
                                    aria-current={isSelected ? 'true' : undefined}
                                    aria-label={`${entry.volume.name} · ${chapterTitleLabel(entry.chapter)}，${meta.label}`}
                                    className={cn(
                                        'h-auto w-full justify-start gap-1.5 rounded-lg px-2 py-1 font-normal',
                                        isSelected && 'bg-accent text-accent-foreground',
                                    )}
                                    onClick={() => onSelectChapter(entry.chapter.id)}
                                >
                                    <span
                                        className={cn('size-1.5 shrink-0 rounded-full', meta.dot)}
                                        aria-hidden="true"
                                    />
                                    <span className="shrink-0 text-muted-foreground tabular-nums">
                                        第 {entry.chapter.order} 章
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-left">
                                        {chapterTitleLabel(entry.chapter)}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground tabular-nums">
                                        {`${formatWordCount(entry.chapter.wordCount)} 字`}
                                    </span>
                                </Button>
                            )
                        })
                    )}
                </div>
            ) : (
                <StateEmpty
                    icon={ScrollText}
                    title="还没有章节"
                    description="点页头「新增」开始起草卷与章节，作品列表新增的卷章也会同步进来"
                    className="border border-dashed border-border py-8"
                />
            )}
        </>
    )
}
