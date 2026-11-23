/**
 * 章纲章节列表：把全部章节平铺成一列，卷筛选与标题搜索在页头完成，这里只负责展示与选中。
 * 复用约定：章节行复用 components/Button 的 ghost 变体，状态点取 PLAN_STATUS_META 的语义底色，
 * 空态复用 components/StateEmpty，标题与字数取自 utils 的 chapterTitleLabel / formatWordCount。
 * 关键约束：本组件只读——新增卷与章节的入口在页头动作区，这里不重复提供；
 * 列表不分卷也不分阶段，卷筛选由调用方先过滤 entries，行顺序始终是全书章序；
 * 行内只放「状态点 + 章节序号 + 标题（左对齐）+ 已写字数」，卷名只进 aria-label。
 */
import { cn } from 'cn'
import { ScrollText } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { OutlineTreeEntry } from '../../types'
import type { JSX } from 'react'
import { PLAN_STATUS_META } from '../../constants'
import { chapterTitleLabel, formatWordCount } from '../../utils'

interface OutlineTreeProps {
    /** 已按卷筛选的扁平章节，数组顺序即全书章序 */
    entries: readonly OutlineTreeEntry[]
    selectedChapterId: string | null
    /** 全量是否有章节：区分「作品还没有大纲」与「筛选后为空」 */
    hasAnyChapter: boolean
    /** 列表是否叠加了卷筛选或标题搜索：筛空时文案要说「没有符合筛选」 */
    isListFiltered: boolean
    onSelectChapter: (chapterId: string) => void
}

export function OutlineTree({
    entries,
    selectedChapterId,
    hasAnyChapter,
    isListFiltered,
    onSelectChapter,
}: OutlineTreeProps): JSX.Element {
    // 只有作品本身没有章节才是「还没有大纲」；卷筛选或搜索筛空不能冒充空作品
    const isEmptyText = isListFiltered ? '没有符合筛选的章节' : '还没有章节'

    return (
        <>
            {hasAnyChapter ? (
                entries.length === 0 ? (
                    <p className="px-2 py-1 text-muted-foreground">{isEmptyText}</p>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {entries.map(({ volume, chapter }) => {
                            const meta = PLAN_STATUS_META[chapter.status]
                            const isSelected = chapter.id === selectedChapterId
                            return (
                                <Button
                                    key={chapter.id}
                                    variant="ghost"
                                    aria-current={isSelected ? 'true' : undefined}
                                    aria-label={`${volume.name} · ${chapterTitleLabel(chapter)}，${meta.label}`}
                                    className={cn(
                                        'h-auto w-full justify-start gap-1.5 rounded-lg py-1 pr-2 pl-2 font-normal',
                                        isSelected && 'bg-accent text-accent-foreground',
                                    )}
                                    onClick={() => onSelectChapter(chapter.id)}
                                >
                                    <span
                                        className={cn('size-1.5 shrink-0 rounded-full', meta.dot)}
                                        aria-hidden="true"
                                    />
                                    <span className="shrink-0 text-muted-foreground tabular-nums">
                                        第 {chapter.order} 章
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-left">
                                        {chapterTitleLabel(chapter)}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground tabular-nums">
                                        {`${formatWordCount(chapter.wordCount)} 字`}
                                    </span>
                                </Button>
                            )
                        })}
                    </div>
                )
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
