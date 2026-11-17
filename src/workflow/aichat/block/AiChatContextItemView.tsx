/**
 * 候选视图：检索行 + 候选列表（笔记 / 文章 / 作品内的章节、人物、大纲），滚动到底追加下一批。
 * 复用约定：查询状态与操作全部来自 ../hooks/useAiChatContextSource，本组件只渲染与转交；
 * 列表取 AiChatContextRowList（含续载哨兵），检索行取 AiChatContextSearchRow，
 * 文案与图标取 contextLabels / contextKindIcons。
 * 关键约束：首批查询由调用方在目标变化时发起，首帧 target 为 null 时按加载中处理，避免先闪一屏空态；
 * 检索行以口径作 key，分类或来源变化即重挂载，输入框不会残留上一分类的关键词。
 */
import type { AiContextAddItem, AiContextItem } from '@shared/types/aiChat'
import { AiChatContextCharacterGrid } from './AiChatContextCharacterGrid'
import { AiChatContextRowList } from './AiChatContextRowList'
import { AiChatContextSearchRow } from './AiChatContextSearchRow'
import { CONTEXT_KIND_ICONS } from './contextKindIcons'
import { CONTEXT_KIND_LABELS, contextSearchPlaceholderOf } from './contextLabels'
import type { AiContextTarget } from '../constants'
import type { AiChatContextQueryState } from '../hooks/useAiChatContextSource'
import type { JSX } from 'react'

export interface AiChatContextItemViewProps {
    query: AiChatContextQueryState
    /** 查询口径：类别与可选来源过滤，由调用方按视图给出 */
    target: AiContextTarget
    /** 提交中：行仍可点，但一律短路，避免重复提交 */
    isSubmitting: boolean
    /** 非菜单场景（作品浮层）：检索行与列表行渲染为普通元素 */
    isPlain: boolean
    /** 提交一批上下文条目：由调用方的 useAddContextItems 注入 */
    onSubmit: (items: AiContextAddItem[]) => Promise<void>
    /** 检索行外置（作品面板与分类页签同排）：本组件只渲染列表 */
    isSearchHidden?: boolean
}

export function AiChatContextItemView({
    query,
    target,
    isSubmitting,
    isPlain,
    onSubmit,
    isSearchHidden = false,
}: AiChatContextItemViewProps): JSX.Element {
    const handlePick = (item: AiContextItem): void => {
        if (isSubmitting) {
            return
        }
        void onSubmit([{ path: item.path, startLine: item.startLine, endLine: item.endLine }])
    }

    /** 行尾辅助信息：章节只给字数（同一目录下的作品名是冗余信息），其余沿用宿主给的副标题 */
    const metaOf = (item: AiContextItem): string | undefined => {
        if (target.kind !== 'chapter') {
            return item.subtitle
        }
        return item.charCount === undefined ? undefined : `${String(item.charCount)} 字`
    }

    return (
        <>
            {isSearchHidden ? null : (
                <AiChatContextSearchRow
                    key={`items:${target.kind}:${target.sourceId ?? ''}`}
                    isPlain={isPlain}
                    isSearching={query.isLoading}
                    placeholder={contextSearchPlaceholderOf(target.kind)}
                    kindLabel={CONTEXT_KIND_LABELS[target.kind]}
                    onSubmit={query.search}
                />
            )}
            {target.kind === 'character' ? (
                <AiChatContextCharacterGrid
                    items={query.items}
                    // 首批查询在 effect 里发起，首帧 target 仍为 null；按加载中处理，避免先闪一下空状态
                    isLoading={query.isLoading || query.target === null}
                    emptyText="没有匹配的人物"
                    onPick={handlePick}
                    hasMore={query.hasMore}
                    onScrollBottom={query.loadMore}
                />
            ) : (
                <AiChatContextRowList
                    isPlain={isPlain}
                    items={query.items}
                    getKey={(item): string => `${item.path}-${item.startLine ?? ''}`}
                    getTitle={(item): string => item.title}
                    getMeta={metaOf}
                    renderRowIcon={(item): JSX.Element => CONTEXT_KIND_ICONS[item.kind]}
                    // 首批查询在 effect 里发起，首帧 target 仍为 null；按加载中处理，避免先闪一下空状态
                    isLoading={query.isLoading || query.target === null}
                    emptyText="没有匹配的内容"
                    onPick={handlePick}
                    hasMore={query.hasMore}
                    onScrollBottom={query.loadMore}
                />
            )}
        </>
    )
}
