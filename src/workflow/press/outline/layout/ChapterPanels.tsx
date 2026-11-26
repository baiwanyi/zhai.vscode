/**
 * 章纲章节列表：把已过滤的章节平铺成一列，点选由调用方打开编辑对话框。
 * 复用约定：列表行用 ItemGroup + Item，空态（空作品 / 筛选为空）均用 blocks/Empty；
 * 行内标题与字数取 utils 的 stripChapterOrderPrefix / formatWordCount，无障碍标签用 chapterTitleLabel。
 * 关键约束：本组件只读；列表不分卷也不分阶段，卷筛选与标题搜索由调用方先过滤 entries，行顺序始终是全书章序；
 * 空作品给出草引导、筛选为空给无匹配提示，两者文案不可混用；行内只放章节序号、标题与已写字数，卷名只进 aria-label。
 */
import { ScrollText } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@components/ui/item'
import { Empty } from '@webview/blocks/Empty'
import type { OutlineTreeEntry } from '../../types'
import type { JSX } from 'react'
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
    // 筛选筛空不等于作品无章节，两者文案分开
    const isEmptyText = isListFiltered ? '无匹配章节' : '暂无章节'

    if (!hasAnyChapter || entries.length === 0) {
        return (
            <Empty
                icon={ScrollText}
                title={hasAnyChapter ? isEmptyText : '还没有章节'}
                description={hasAnyChapter ? undefined : '点页头「新增」开始起草'}
                className="py-8"
            />
        )
    }
    return (
        <ItemGroup className="has-data-[size=xs]:gap-1">
            {entries.map(({ volume, chapter }) => (
                <Item
                    key={chapter.id}
                    size="xs"
                    className="cursor-pointer flex-nowrap hover:bg-muted/50"
                    aria-label={`${volume.name} · ${chapterTitleLabel(chapter)}`}
                    onClick={() => onSelectChapter(chapter.id)}
                >
                    <ItemContent className="flex-row items-center group-data-[size=xs]/item:gap-1">
                        <span className="shrink-0 text-muted-foreground tabular-nums">第{chapter.order}章</span>
                        <ItemTitle className="w-auto min-w-0 flex-1">
                            {stripChapterOrderPrefix(chapter.title)}
                        </ItemTitle>
                    </ItemContent>
                    <ItemActions className="shrink-0 text-muted-foreground tabular-nums">
                        {`${formatWordCount(chapter.wordCount)} 字`}
                    </ItemActions>
                </Item>
            ))}
        </ItemGroup>
    )
}
