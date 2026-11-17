/**
 * 来源视图：检索行 + 来源列表（笔记本 / 作品），按名称本地过滤，选中后交给调用方决定如何加入。
 * 复用约定：列表取同目录 AiChatContextRowList，检索行取 AiChatContextSearchRow，
 * 文案与图标取 contextLabels / contextKindIcons；提交入口由调用方注入 useAddContextItems。
 * 关键约束：关键词只在本层持有，检索行以口径作 key——口径变化即重挂载，输入框不会残留上一入口的关键词；
 * 过滤无结果与真的没有来源必须分开提示，否则用户会以为数据丢了；
 * 笔记本整本加入（超限由宿主自动压缩），其余来源交给外壳另开面板。
 */
import { useMemo, useState } from 'react'
import type { AiContextAddItem, AiContextSource, AiContextSourceScope } from '@shared/types/aiChat'
import { AiChatContextRowList } from './AiChatContextRowList'
import { AiChatContextSearchRow } from './AiChatContextSearchRow'
import { CONTEXT_SCOPE_ICONS } from './contextKindIcons'
import { CONTEXT_SCOPE_LABELS } from './contextLabels'
import type { JSX } from 'react'

export interface AiChatContextSourceViewProps {
    scope: AiContextSourceScope
    sources: readonly AiContextSource[]
    isLoading: boolean
    /** 提交中：行仍可点，但一律短路，避免重复提交 */
    isSubmitting: boolean
    /** 非菜单场景（作品浮层）：检索行与列表行渲染为普通元素 */
    isPlain: boolean
    /** 提交一批上下文条目：由调用方的 useAddContextItems 注入 */
    onSubmit: (items: AiContextAddItem[]) => Promise<void>
    /** 选中作品：由外壳收起菜单并另开作品面板 */
    onPickProject: (dirPath: string) => void
}

export function AiChatContextSourceView({
    scope,
    sources,
    isLoading,
    isSubmitting,
    isPlain,
    onSubmit,
    onPickProject,
}: AiChatContextSourceViewProps): JSX.Element {
    const [keyword, setKeyword] = useState('')

    /** 关键词归一化只在输入变化时算一次，避免每次渲染重复 trim / toLowerCase */
    const normalizedKeyword = useMemo((): string => keyword.trim().toLowerCase(), [keyword])

    /** 过滤结果缓存：提交态、加载态引起的重渲染不再重建同一份数组 */
    const matchedSources = useMemo(
        (): readonly AiContextSource[] =>
            normalizedKeyword === ''
                ? sources
                : sources.filter((source) => source.name.toLowerCase().includes(normalizedKeyword)),
        [normalizedKeyword, sources],
    )

    const handlePick = (source: AiContextSource): void => {
        if (isSubmitting) {
            return
        }
        if (scope === 'notebook') {
            void onSubmit([{ path: source.id }])
            return
        }
        onPickProject(source.id)
    }

    return (
        <>
            <AiChatContextSearchRow
                key={`source:${scope}`}
                isPlain={isPlain}
                isSearching={false}
                placeholder="筛选名称"
                kindLabel={CONTEXT_SCOPE_LABELS[scope]}
                onSubmit={(next): void => setKeyword(next)}
            />
            <AiChatContextRowList
                isPlain={isPlain}
                items={matchedSources}
                getKey={(source): string => source.id}
                getTitle={(source): string => source.name}
                getMeta={(source): string => `${String(source.count)} 篇`}
                renderRowIcon={(): JSX.Element => CONTEXT_SCOPE_ICONS[scope]}
                isLoading={isLoading}
                // 过滤无结果与真的没有来源要分开说，否则用户会以为数据丢了
                emptyText={normalizedKeyword === '' ? `还没有${CONTEXT_SCOPE_LABELS[scope]}` : '没有匹配的名称'}
                onPick={handlePick}
            />
        </>
    )
}
