/**
 * 「添加上下文」选择器：根列表、规则、来源列表、候选列表与作品分类五种视图都由本组件渲染。
 * 复用约定：浮层外壳（触发器与 Popover）由同目录 AiChatContextMenu 提供，本组件只渲染内容；
 * 搜索行取同目录 AiChatSearchField，列表项取 @webview/components/Button，
 * 分页与即时搜索由 ../hooks/useAiChatContextSource 承担，添加走宿主 ai/context/add。
 * 关键约束：视图切换只在浮层内进行，不关闭面板；滚动到底追加下一批而不是换页；
 * 选中即添加并关闭，失败保持打开便于重选；作品分类里的设定走多选面板，不在本组件内实现。
 */
import { cn } from 'cn'
import { ChevronLeft, FileArchive } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiContextAddItem, AiContextAddResult, AiContextItem, AiContextSource } from '@shared/types/aiChat'
import type { PromptRule } from '@shared/types/promptLibrary'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { AiChatContextRootList } from './AiChatContextRootList'
import { AiChatRulePanel } from './AiChatRulePanel'
import { AiChatSearchField } from './AiChatSearchField'
import { AiChatSettingPicker } from './AiChatSettingPicker'
import type { AiContextPickerView, AiContextProjectTab, AiContextTarget } from '../constants'
import type { JSX, UIEvent } from 'react'
import { useAiChatContextQuery, useAiChatContextSources } from '../hooks/useAiChatContextSource'

/** 列表滚动到底的触发阈值：留一屏边距，滚到底前就开始加载 */
const SCROLL_THRESHOLD = 32

/** 作品分类标签：顺序即展示顺序 */
const PROJECT_TABS: readonly { key: AiContextProjectTab; label: string }[] = [
    { key: 'chapter', label: '章节' },
    { key: 'character', label: '人物' },
    { key: 'outline', label: '大纲' },
    { key: 'setting', label: '设定' },
]

interface AiChatContextPickerProps {
    /** 当前视图：由工具行持有，面板内部只向上切换 */
    view: AiContextPickerView
    onViewChange: (view: AiContextPickerView) => void
    onClose: () => void
    /** 添加成功后由页面重拉上下文清单 */
    onAdded: () => void
    onError: (error: string) => void
    /** 规则视图的数据与动作：与工具行的 useRuleMenu 同一份状态 */
    rules: readonly PromptRule[]
    isLoadingRules: boolean
    selectedRules: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onEditRule: (rule: PromptRule) => void
    onDeleteRule: (rule: PromptRule) => void
    onCreateRule: () => void
    onOpenRuleDir: () => void
}

interface ContextItemListProps {
    items: readonly AiContextItem[]
    isLoading: boolean
    emptyText: string
    onPick: (item: AiContextItem) => void
    onScrollBottom: () => void
}

/** 候选列表：单行标题 + 右侧辅助信息，滚动到底是加载更多 */
function ContextItemList({ items, isLoading, emptyText, onPick, onScrollBottom }: ContextItemListProps): JSX.Element {
    const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
        const target = event.currentTarget
        if (target.scrollHeight - target.scrollTop - target.clientHeight <= SCROLL_THRESHOLD) {
            onScrollBottom()
        }
    }
    return (
        <div className="max-h-72 overflow-y-auto overscroll-contain" onScroll={handleScroll}>
            {items.length === 0 ? (
                <div className="px-1.5 py-1.5 text-xs text-muted-foreground">{isLoading ? '读取中…' : emptyText}</div>
            ) : (
                items.map((item) => (
                    <Button
                        key={`${item.path}-${String(item.startLine ?? 0)}`}
                        variant="ghost"
                        className="h-auto w-full justify-start gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-normal"
                        onClick={() => onPick(item)}
                    >
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.subtitle === undefined ? null : (
                            <span className="shrink-0 text-xs text-muted-foreground">{item.subtitle}</span>
                        )}
                    </Button>
                ))
            )}
            {isLoading && items.length > 0 ? (
                <div className="px-2 py-1.5 text-center text-xs text-muted-foreground">加载中…</div>
            ) : null}
        </div>
    )
}

interface ContextSourceListProps {
    sources: readonly AiContextSource[]
    isLoading: boolean
    emptyText: string
    /** 笔记本来源额外提供「压缩后添加」，作品来源不需要 */
    canCompress: boolean
    /** 提交进行中：压缩可能耗时十余秒，期间禁用整行 */
    isBusy: boolean
    onPick: (source: AiContextSource, compress: boolean) => void
}

/** 来源列表：笔记本与作品共用，数量少，按名称包含即可过滤 */
function ContextSourceList({
    sources,
    isLoading,
    emptyText,
    canCompress,
    isBusy,
    onPick,
}: ContextSourceListProps): JSX.Element {
    const [keyword, setKeyword] = useState('')
    const normalized = keyword.trim().toLowerCase()
    const matched = sources.filter((source) => source.name.toLowerCase().includes(normalized))
    return (
        <>
            <div className="px-1 pb-1">
                <AiChatSearchField isSearching={false} onSubmit={setKeyword} placeholder="筛选名称" />
            </div>
            <div className="max-h-72 overflow-y-auto overscroll-contain">
                {matched.length === 0 ? (
                    <div className="px-1.5 py-1.5 text-xs text-muted-foreground">
                        {isLoading ? '读取中…' : emptyText}
                    </div>
                ) : (
                    matched.map((source) => (
                        <div key={source.id} className="flex items-center">
                            <Button
                                variant="ghost"
                                className="h-auto min-w-0 flex-1 justify-start gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-normal"
                                disabled={isBusy}
                                onClick={() => onPick(source, false)}
                            >
                                <span className="min-w-0 flex-1 truncate">{source.name}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{source.count} 篇</span>
                            </Button>
                            {canCompress ? (
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="mr-1 shrink-0 text-muted-foreground"
                                    aria-label={`压缩后添加${source.name}`}
                                    tooltip="AI 压缩后添加（消耗一次模型调用）"
                                    disabled={isBusy}
                                    onClick={() => onPick(source, true)}
                                >
                                    <FileArchive />
                                </Button>
                            ) : null}
                        </div>
                    ))
                )}
            </div>
        </>
    )
}

export function AiChatContextPicker({
    view,
    onViewChange,
    onClose,
    onAdded,
    onError,
    rules,
    isLoadingRules,
    selectedRules,
    onToggleRule,
    onEditRule,
    onDeleteRule,
    onCreateRule,
    onOpenRuleDir,
}: AiChatContextPickerProps): JSX.Element {
    /** 提交进行中：压缩会等待一次模型调用，期间禁用列表避免重复提交 */
    const [isSubmitting, setIsSubmitting] = useState(false)
    const query = useAiChatContextQuery(onError)
    const sourceScope = view.mode === 'source' ? view.scope : null
    const sourcesState = useAiChatContextSources(sourceScope, onError)

    /** 查询目标：根列表、规则、来源列表与设定页都不发候选查询 */
    const queryTarget = useMemo((): AiContextTarget | null => {
        if (view.mode === 'items') {
            return view.target
        }
        if (view.mode === 'project' && view.tab !== 'setting') {
            return { kind: view.tab, sourceId: view.dirPath }
        }
        return null
    }, [view])

    // 回调走 ref：避免把 select / reset 拖进 effect 依赖后每次渲染都重发同一批查询
    const selectRef = useRef(query.select)
    const resetRef = useRef(query.reset)
    useEffect((): void => {
        selectRef.current = query.select
        resetRef.current = query.reset
    }, [query.select, query.reset])

    useEffect((): void => {
        if (queryTarget === null) {
            resetRef.current()
            return
        }
        selectRef.current(queryTarget)
    }, [queryTarget])

    /** 统一提交：单条与批量共用同一套成功收尾与失败提示 */
    const submitItems = async (items: AiContextAddItem[]): Promise<void> => {
        setIsSubmitting(true)
        try {
            const result = await request<AiContextAddResult>('ai/context/add', { items })
            if (result.added === 0) {
                onError(
                    result.failed[0]?.reason ??
                        (result.isFull ? '上下文已达上限，请先移除部分引用' : '该条目已在上下文中'),
                )
                return
            }
            onAdded()
            onClose()
        } catch (cause) {
            onError(toErrorText(cause))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handlePickItem = (item: AiContextItem): void => {
        void submitItems([{ path: item.path, startLine: item.startLine, endLine: item.endLine }])
    }

    /** 笔记本按整本加入：宿主打包后回传实际字数与篇数，compress 为真时先由模型压缩 */
    const handlePickSource = (source: AiContextSource, compress: boolean): void => {
        if (view?.mode !== 'source') {
            return
        }
        if (view.scope === 'notebook') {
            void submitItems([{ path: source.id, compress }])
            return
        }
        onViewChange({ mode: 'project', dirPath: source.id, tab: 'chapter' })
    }

    /** 标题文案：视图决定，根视图固定为「添加上下文」 */
    const headerTitle = ((): string => {
        if (view.mode === 'root') {
            return '添加上下文'
        }
        if (view.mode === 'rules') {
            return '规则'
        }
        if (view.mode === 'source') {
            return view.scope === 'notebook' ? '选择笔记本' : '选择作品'
        }
        if (view.mode === 'project') {
            return view.dirPath.replace(/^press\//u, '')
        }
        return view.target.kind === 'article' ? '最近文章' : '最近笔记'
    })()

    /** 返回动作：作品分类回作品列表，带来源的候选回来源列表，其余回根列表 */
    const backView = ((): (() => void) | null => {
        if (view.mode === 'root') {
            return null
        }
        if (view.mode === 'project') {
            return (): void => onViewChange({ mode: 'source', scope: 'project' })
        }
        if (view.mode === 'items' && view.target.sourceId !== undefined) {
            return (): void => onViewChange({ mode: 'source', scope: 'notebook' })
        }
        return (): void => onViewChange({ mode: 'root' })
    })()

    const renderBody = (): JSX.Element => {
        if (view.mode === 'root') {
            return <AiChatContextRootList onSelect={onViewChange} selectedRuleCount={selectedRules.length} />
        }
        if (view.mode === 'rules') {
            return (
                <AiChatRulePanel
                    rules={rules}
                    isLoading={isLoadingRules}
                    selectedRules={selectedRules}
                    onToggle={onToggleRule}
                    onEdit={onEditRule}
                    onDelete={onDeleteRule}
                    onCreate={onCreateRule}
                    onOpenDir={onOpenRuleDir}
                />
            )
        }
        if (view.mode === 'source') {
            return (
                <ContextSourceList
                    sources={sourcesState.sources}
                    isLoading={sourcesState.isLoading}
                    emptyText={view.scope === 'notebook' ? '还没有笔记本' : '还没有作品'}
                    canCompress={view.scope === 'notebook'}
                    isBusy={isSubmitting}
                    onPick={handlePickSource}
                />
            )
        }
        if (view.mode === 'project' && view.tab === 'setting') {
            return <AiChatSettingPicker dirPath={view.dirPath} onClose={onClose} onAdded={onAdded} onError={onError} />
        }
        return (
            <>
                <div className="px-1 pb-1">
                    <AiChatSearchField
                        isSearching={query.isLoading}
                        onSubmit={query.search}
                        placeholder={
                            view.mode === 'items' && view.target.kind === 'article' ? '搜索文章标题' : '搜索标题'
                        }
                    />
                </div>
                <ContextItemList
                    items={query.items}
                    isLoading={query.isLoading}
                    emptyText="没有匹配的内容"
                    onPick={handlePickItem}
                    onScrollBottom={query.loadMore}
                />
            </>
        )
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1 px-1.5 py-1">
                    {backView === null ? null : (
                        <Button variant="ghost" size="icon-xs" aria-label="返回上一级" onClick={backView}>
                            <ChevronLeft />
                        </Button>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                        {headerTitle}
                    </span>
                </div>
                {view.mode === 'project' ? (
                    <div className="flex items-center gap-0.5">
                        {PROJECT_TABS.map((tab) => (
                            <Button
                                key={tab.key}
                                variant={view.tab === tab.key ? 'secondary' : 'ghost'}
                                size="xs"
                                className={cn('flex-1')}
                                onClick={() => onViewChange({ ...view, tab: tab.key })}
                            >
                                {tab.label}
                            </Button>
                        ))}
                    </div>
                ) : null}
            </div>
            {renderBody()}
        </div>
    )
}
