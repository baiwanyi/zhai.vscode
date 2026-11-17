/**
 * 「添加上下文」的子菜单：内容容器（取数 / 提交编排 / 视图分发）与一级菜单项外壳在同一文件闭环。
 * 复用约定：子菜单壳取 @components/ui 的 dropdown-menu 的 Sub / SubTrigger / SubContent / Portal；
 * 视图与展示块在 ../block——来源视图 AiChatContextSourceView、候选视图 AiChatContextItemView，
 * 行列表与检索行分别由 AiChatContextRowList / AiChatContextSearchRow 承担；
 * 取数走 ../hooks/useAiChatContextSource，提交走 ../hooks/useAddContextItems。
 * 关键约束：内容只在展开时挂载（关闭态 Radix 不渲染 SubContent），四个入口不会在菜单刚打开时各自预取；
 * view 的引用必须稳定（入口清单用模块级常量、作品面板用 useMemo），否则每次渲染都会重发同一批查询；
 * 本层只做视图分发，过滤、行渲染与滚动观察都已下沉到对应视图与列表组件。
 */
import {
    DropdownMenuPortal,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'
import type { AiChatContextSubMenuCallbacks, AiContextPickerView } from '../constants'
import type { JSX } from 'react'
import { AiChatContextItemView } from '../block/AiChatContextItemView'
import { AiChatContextSourceView } from '../block/AiChatContextSourceView'
import { CONTEXT_SUB_PANEL_CLASS, CONTEXT_SUB_TRIGGER_CLASS } from '../block/menuStyles'
import { useAddContextItems } from '../hooks/useAddContextItems'
import { useAiChatContextQuery, useAiChatContextSources, useContextQueryTarget } from '../hooks/useAiChatContextSource'

/** 子菜单内容的入参：外壳只需视图与回调 */
export interface AiChatContextSourceSubMenuBodyProps extends AiChatContextSubMenuCallbacks {
    view: AiContextPickerView
    /** 非菜单场景（作品浮层）：检索行与列表行渲染为普通元素，不依赖菜单上下文 */
    isPlain?: boolean
}

/**
 * 子菜单内容：只在子菜单展开时挂载（Radix 关闭态不渲染 SubContent），来源列表与候选查询随之一并懒加载，
 * 四个入口不会在菜单刚打开时就各自预取；导出供作品浮层复用同一份检索与候选列表。
 */
export function AiChatContextSourceSubMenuBody({
    view,
    onClose,
    onAdded,
    onError,
    onPickProject,
    isPlain = false,
}: AiChatContextSourceSubMenuBodyProps): JSX.Element {
    const query = useAiChatContextQuery(onError)
    const sourceScope = view.mode === 'source' ? view.scope : null
    const sourcesState = useAiChatContextSources(sourceScope, onError)
    const { isSubmitting, submitItems } = useAddContextItems(onAdded, onClose, onError)
    // 目标切换：view 稳定则 target 引用稳定，切分类 / 换作品只发一批新查询
    useContextQueryTarget(query, view.mode === 'items' ? view.target : null)

    if (view.mode === 'source') {
        return (
            <AiChatContextSourceView
                scope={view.scope}
                sources={sourcesState.sources}
                isLoading={sourcesState.isLoading}
                isSubmitting={isSubmitting}
                isPlain={isPlain}
                onSubmit={submitItems}
                onPickProject={onPickProject}
            />
        )
    }

    return (
        <AiChatContextItemView
            query={query}
            target={view.target}
            isSubmitting={isSubmitting}
            isPlain={isPlain}
            onSubmit={submitItems}
        />
    )
}

export interface AiChatContextSourceSubMenuEntryProps extends AiChatContextSubMenuCallbacks {
    /** 一级菜单项文案：子菜单的触发项由本组件渲染 */
    label: string
    /** 一级菜单项图标：由外壳给出，与其它菜单项同一套尺寸 */
    icon: JSX.Element
    /** 子菜单内容：来源列表（笔记本 / 作品）或候选列表（笔记 / 文章 / 作品内容） */
    view: AiContextPickerView
}

/** 一级菜单项 + 子菜单内容：触发项常驻，内容在展开时才挂载 */
export function AiChatContextSourceSubMenuEntry({
    label,
    icon,
    view,
    onClose,
    onAdded,
    onError,
    onPickProject,
}: AiChatContextSourceSubMenuEntryProps): JSX.Element {
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger className={CONTEXT_SUB_TRIGGER_CLASS}>
                {icon}
                <span className="min-w-0 flex-1 truncate">{label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
                <DropdownMenuSubContent className={CONTEXT_SUB_PANEL_CLASS}>
                    <AiChatContextSourceSubMenuBody
                        view={view}
                        onClose={onClose}
                        onAdded={onAdded}
                        onError={onError}
                        onPickProject={onPickProject}
                    />
                </DropdownMenuSubContent>
            </DropdownMenuPortal>
        </DropdownMenuSub>
    )
}
