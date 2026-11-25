/**
 * 章纲章节列表：把全部章节平铺成一列，点选章节由调用方打开详情对话框。
 * 复用约定：列表行用 shadcn ItemGroup + Item，点击直接回调打开编辑对话框，状态点取 PLAN_STATUS_META 的语义底色；
 * 空态复用 blocks/StateEmpty，行内标题与字数取自 utils 的 stripChapterOrderPrefix / formatWordCount，无障碍标签用 chapterTitleLabel。
 * 关键约束：本组件只读；列表不分卷也不分阶段，卷筛选由调用方先过滤 entries，行顺序始终是全书章序；
 * 状态点语义底色由 PLAN_STATUS_META 提供，行内只放「状态点 + 章节序号 + 标题 + 已写字数」，卷名只进 aria-label。
 */
import { cn } from 'cn'
import { ScrollText } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import type { OutlineTreeEntry } from '../../types'
import type { JSX } from 'react'
import { PLAN_STATUS_META } from '../../constants'
import { chapterTitleLabel, formatWordCount, stripChapterOrderPrefix } from '../../utils'

interface ChapterPanelsProps {
    /** 已按卷筛选与标题搜索过滤的列表项 */
    entries: readonly OutlineTreeEntry[]
    /** 全量是否有章节：区分空作品与筛选后为空 */
    hasAnyChapter: boolean
    /** 列表是否叠加了卷筛选或标题搜索 */
    isListFiltered: boolean
    /** 单击章节打开编辑对话框 */
    onSelectChapter: (chapterId: string) => void
}

export function ChapterPanels({
    entries,
    hasAnyChapter,
    isListFiltered,
    onSelectChapter,
}: ChapterPanelsProps): JSX.Element {
    // 只有作品本身没有章节才是「还没有大纲」；卷筛选或搜索筛空不能冒充空作品
    const isEmptyText = isListFiltered ? '没有符合筛选的章节' : '还没有章节'

    if (!hasAnyChapter) {
        return (
            <StateEmpty
                icon={ScrollText}
                title="还没有章节"
                description="点页头「新增」开始起草卷与章节，作品列表新增的卷章也会同步进来"
                className="border border-dashed border-border py-8"
            />
        )
    }
    if (entries.length === 0) {
        return <p className="px-2 py-1 text-muted-foreground">{isEmptyText}</p>
    }
    return (
        <ItemGroup>
            {entries.map(({ volume, chapter }) => {
                const meta = PLAN_STATUS_META[chapter.status]
                return (
                    <Item
                        key={chapter.id}
                        size="xs"
                        className="cursor-pointer flex-nowrap hover:bg-muted/50"
                        aria-label={`${volume.name} · ${chapterTitleLabel(chapter)}，${meta.label}`}
                        onClick={() => onSelectChapter(chapter.id)}
                    >
                        <ItemMedia>
                            <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
                        </ItemMedia>
                        <ItemContent className="flex-row items-center gap-1.5">
                            <span className="shrink-0 text-muted-foreground tabular-nums">第 {chapter.order} 章</span>
                            <ItemTitle className="w-auto min-w-0 flex-1">
                                {stripChapterOrderPrefix(chapter.title)}
                            </ItemTitle>
                        </ItemContent>
                        <ItemActions className="shrink-0 text-muted-foreground tabular-nums">
                            {`${formatWordCount(chapter.wordCount)} 字`}
                        </ItemActions>
                    </Item>
                )
            })}
        </ItemGroup>
    )
}
