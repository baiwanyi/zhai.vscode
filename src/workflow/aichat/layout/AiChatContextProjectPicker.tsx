/**
 * 作品面板：独立浮层里的全部内容——标题行（作品名）、分类页签，
 * 下方按分类渲染候选列表（章节 / 人物 / 大纲）或设定多选（本文件内的 ProjectSettingPanel）。
 * 复用约定：标题行取 @components/ui 的 PopoverHeader / PopoverTitle，分类页签与设定分组取 ToggleGroup，
 * 候选列表复用 ../block 的 AiChatContextItemView 非菜单形态（检索行 + 候选 + 滚动续载）；
 * 分类文案取 ../utils/context/labels，回调统一取 ../utils/context/types 的公共基座，设定分节行取宿主 ai/context/sections。
 * 关键约束：view 必须按目录与分类 memo 稳定，否则每次渲染都会让内容层重发同一批查询；
 * 整层不在菜单上下文内，因此只能用普通按钮，不能出现 DropdownMenuItem；
 * 换作品由外壳的 key 重新挂载，页签与勾选一并复位；设定分类自带提交按钮并自行在添加成功后关闭浮层。
 */
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { PopoverHeader, PopoverTitle } from '@components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { AiContextAddItem, AiDocSection, AiDocSectionsResult } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { isLoreSection, SETTING_SECTIONS, SETTING_SECTION_ORDER } from '@webview/workflow/press/setting/sections'
import type { SettingSectionKey } from '@webview/workflow/press/setting/sections'
import { AiChatSearchField } from './AiChatSearchField'
import type { AiChatContextSubMenuCallbacks, AiContextProjectTab, AiContextTarget } from '../utils/context/types'
import type { JSX } from 'react'
import { AiChatContextItemView } from '../block/AiChatContextItemView'
import { useAddContextItems } from '../hooks/useAddContextItems'
import { useAiChatContextQuery, useContextQueryTarget } from '../hooks/useAiChatContextSource'
import { CONTEXT_KIND_LABELS, contextSearchPlaceholderOf } from '../utils/context/labels'
import { CONTEXT_PICK_BUTTON_CLASS } from '../utils/context/styles'

/** 分类顺序：顺序即页签顺序，首项为默认分类 */
const PROJECT_TABS: readonly AiContextProjectTab[] = ['chapter', 'character', 'outline', 'setting']

/** 设定分组栏：窄栏深底，选中态取主色实心，与右侧条目区拉开层级 */
const SECTION_RAIL_CLASS = 'w-32 shrink-0 overflow-y-auto bg-muted p-1.5'

/** 设定分组项：右端带该组条目数，选中态用主色 */
const SECTION_ITEM_CLASS =
    'justify-between gap-1 text-xs text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'

/** 设定面板：撑满浮层留给内容的剩余高度，条目区自己滚动，不再自带固定高度 */
const PANEL_HEIGHT_CLASS = 'min-h-0 flex-1'

/** 内容区：固定一屏高度，超出部分交给内部滚动——浮层总高随这一段走，不再靠外层限高 */
const CONTENT_HEIGHT_CLASS = 'flex h-80 flex-col overflow-hidden'

/** 分类键收窄：ToggleGroup 回传裸字符串，点已选项还会回传空串 */
function isProjectTab(value: string): value is AiContextProjectTab {
    return PROJECT_TABS.some((tab) => tab === value)
}

/** 作品名：目录末段即作品名（press/{作品名}） */
function readProjectName(dirPath: string): string {
    return dirPath.split('/').pop() ?? dirPath
}

/** 分组加载结果：sections 已按该分组的选取粒度过滤 */
interface SettingGroup {
    key: SettingSectionKey
    sections: readonly AiDocSection[]
}

/** 设定分组键收窄：ToggleGroup 回传的是裸字符串，点已选项还会回传空串 */
function isSectionKey(value: string): value is SettingSectionKey {
    return SETTING_SECTION_ORDER.some((key) => key === value)
}

interface ProjectSettingPanelProps {
    /** 作品目录：press/{作品名} */
    dirPath: string
    /** 读取失败的提示出口 */
    onError: (error: string) => void
    /** 提交上下文条目：由调用方的 useAddContextItems 注入，与候选视图同一套收尾逻辑 */
    onSubmit: (items: AiContextAddItem[]) => Promise<void>
    /** 提交中：按钮一律短路，避免连点重复提交 */
    isSubmitting: boolean
    /** 检索关键词：与候选视图共用作品面板顶部那一个搜索栏，由外层持有 */
    keyword: string
    /** 清空检索：切分组时调用，避免检索态忽略左栏选择 */
    onKeywordChange: (keyword: string) => void
}

/**
 * 设定分类的选择面板：左侧切换「基本信息 / 世界观 / 金手指 / 势力 / 地点 / 物品」，右侧按钮网格。
 * 复用约定：分组文案、文件名与分级依据取自 press 的 SETTING_SECTIONS 与 isLoreSection，
 * 分节行区间由宿主 ai/context/sections 提供；检索框由作品面板顶部的搜索栏统一提供，
 * 分类栏取同层 ToggleGroup，条目按钮与人物网格共用 CONTEXT_PICK_BUTTON_CLASS。
 * 关键约束：字段型分组按三级标题取字段，条目型分组按二级标题取条目；
 * 点条目即加入该条、点分组标题右侧的「整篇」即加入整份文档，加入成功后由调用方收起浮层；
 * 有关键词时跨分组平铺命中项、不受左栏选择影响，切左栏即清空关键词。
 */
function ProjectSettingPanel({
    dirPath,
    onError,
    onSubmit,
    isSubmitting,
    keyword,
    onKeywordChange,
}: ProjectSettingPanelProps): JSX.Element {
    const [groups, setGroups] = useState<readonly SettingGroup[]>([])
    /** 当前分组：默认落在基本信息，与 SETTING_SECTION_ORDER 首项一致 */
    const [activeKey, setActiveKey] = useState<SettingSectionKey>('basic')
    const [isLoading, setIsLoading] = useState(true)

    useEffect((): (() => void) => {
        let isActive = true
        const requests = SETTING_SECTION_ORDER.map((key) => {
            const doc = SETTING_SECTIONS[key].docKey
            const level = isLoreSection(key) ? 2 : 3
            return request<AiDocSectionsResult>('ai/context/sections', { dirPath, doc }).then((result) => ({
                key,
                sections: result.sections.filter((section) => section.level === level),
            }))
        })
        void Promise.all(requests)
            .then((loaded) => {
                if (isActive) {
                    setGroups(loaded)
                }
            })
            .catch((cause: unknown) => {
                if (isActive) {
                    setGroups([])
                    onError(toErrorText(cause))
                }
            })
            .finally(() => {
                if (isActive) {
                    setIsLoading(false)
                }
            })
        return (): void => {
            isActive = false
        }
    }, [dirPath, onError])

    const normalized = keyword.trim().toLowerCase()

    /**
     * 可见分组：无关键词只看当前分组，有关键词跨分组平铺命中项；
     * 分组标题命中时整组保留，否则按条目名过滤。
     */
    const visibleGroups = useMemo((): readonly SettingGroup[] => {
        const isSearching = normalized.length > 0
        return groups
            .filter((group) => isSearching || group.key === activeKey)
            .map((group) => ({
                key: group.key,
                sections:
                    !isSearching || SETTING_SECTIONS[group.key].label.toLowerCase().includes(normalized)
                        ? group.sections
                        : group.sections.filter((section) => section.title.toLowerCase().includes(normalized)),
            }))
            .filter((group) => group.sections.length > 0)
    }, [groups, activeKey, normalized])

    /** 切换分组：清空关键词，否则检索态会忽略左栏选择 */
    const handleSectionChange = (next: string): void => {
        if (!isSectionKey(next)) {
            return
        }
        setActiveKey(next)
        onKeywordChange('')
    }

    /** 点条目即加入该节：行区间随条目一起提交 */
    const addSection = (fileName: string, section: AiDocSection): void => {
        if (isSubmitting) {
            return
        }
        void onSubmit([{ path: `${dirPath}/${fileName}`, startLine: section.startLine, endLine: section.endLine }])
    }

    /** 点「整篇」即加入整份文档：不带行区间，发送时按全文读取 */
    const addWhole = (fileName: string): void => {
        if (isSubmitting) {
            return
        }
        void onSubmit([{ path: `${dirPath}/${fileName}` }])
    }

    return (
        <div className={cn('flex flex-col gap-2', PANEL_HEIGHT_CLASS)}>
            <div className="flex min-h-0 flex-1 gap-2">
                <ToggleGroup
                    type="single"
                    orientation="vertical"
                    size="sm"
                    spacing={0.5}
                    value={activeKey}
                    aria-label="设定分组"
                    className={SECTION_RAIL_CLASS}
                    onValueChange={handleSectionChange}
                >
                    {SETTING_SECTION_ORDER.map((key) => {
                        const count = groups.find((group) => group.key === key)?.sections.length ?? 0
                        return (
                            <ToggleGroupItem key={key} value={key} className={SECTION_ITEM_CLASS}>
                                <span className="min-w-0 truncate">{SETTING_SECTIONS[key].label}</span>
                                {count === 0 ? null : <Badge variant="secondary">{count}</Badge>}
                            </ToggleGroupItem>
                        )
                    })}
                </ToggleGroup>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {visibleGroups.length === 0 ? (
                        <div className="px-1.5 py-1.5 text-xs text-muted-foreground">
                            {isLoading ? '读取中…' : '没有可选的设定项'}
                        </div>
                    ) : (
                        visibleGroups.map((group) => {
                            const meta = SETTING_SECTIONS[group.key]
                            return (
                                <div key={group.key} className="pb-1">
                                    <div className="flex items-center gap-2 px-1.5 py-1">
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                            {meta.label}
                                        </span>
                                        <button
                                            type="button"
                                            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
                                            disabled={isSubmitting}
                                            onClick={(): void => addWhole(meta.fileName)}
                                        >
                                            整篇
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 content-start gap-1.5">
                                        {group.sections.map((section) => (
                                            <button
                                                key={`${meta.fileName}-${String(section.startLine)}`}
                                                type="button"
                                                className={CONTEXT_PICK_BUTTON_CLASS}
                                                disabled={isSubmitting}
                                                onClick={(): void => addSection(meta.fileName, section)}
                                            >
                                                <span className="min-w-0 flex-1 truncate">{section.title}</span>
                                                <span className="shrink-0 text-xs text-muted-foreground">
                                                    {section.charCount} 字
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    )
}

export interface AiChatContextProjectPickerProps extends AiChatContextSubMenuCallbacks {
    /** 作品目录：press/{作品名} */
    dirPath: string
}

/**
 * 作品面板：标题行（作品名）、分类页签、按页签渲染候选列表或设定面板。
 * 标题收在 PopoverHeader 里，与提示词面板（AiChatPromptPicker）同一套浮层骨架：
 * 标题行 → 页签 + 搜索栏 → 内容区吃满剩余高度，浮层高度不随分类切换跳动，也不会被内容撑破。
 * 搜索栏四类分类共用：章节 / 人物 / 大纲交给宿主检索，设定分类在本地过滤已读取的分节。
 */
export function AiChatContextProjectPicker({
    dirPath,
    scope,
    onClose,
    onAdded,
    onError,
}: AiChatContextProjectPickerProps): JSX.Element {
    /** 当前分类：默认首项（章节），换作品时由外壳的 key 重新挂载复位 */
    const [tab, setTab] = useState<AiContextProjectTab>('chapter')
    /** 设定分类的检索词：设定是本地过滤，走不到宿主的候选查询，故与 query.search 分开持有 */
    const [settingKeyword, setSettingKeyword] = useState('')
    /** 查询口径：目录与分类任一变化都换对象，其余情况保持引用稳定，避免内容层反复重发查询 */
    const target = useMemo((): AiContextTarget => ({ kind: tab, sourceId: dirPath }), [dirPath, tab])
    const query = useAiChatContextQuery(onError)
    const { isSubmitting, submitItems } = useAddContextItems(onAdded, onClose, onError, scope)
    // 目标切换：检索行与列表都在本层，切分类只发一批新查询；
    // 设定分类走本地分节与过滤，宿主候选查询不接受 kind=setting，故传 null 复位而不是发请求
    useContextQueryTarget(query, tab === 'setting' ? null : target)

    /** 切换分类：点已选项会回传空串，不合法就忽略；换分类即清掉设定的检索词 */
    const handleTabChange = (next: string): void => {
        if (!isProjectTab(next)) {
            return
        }
        setTab(next)
        setSettingKeyword('')
    }

    return (
        <>
            <PopoverHeader className="shrink-0">
                <PopoverTitle className="min-w-0 truncate text-sm">{readProjectName(dirPath)}</PopoverTitle>
            </PopoverHeader>
            <div className="flex shrink-0 items-center gap-2">
                <ToggleGroup
                    type="single"
                    size="sm"
                    spacing={0.5}
                    value={tab}
                    aria-label="作品分类"
                    className="min-w-0 flex-1 justify-start"
                    onValueChange={handleTabChange}
                >
                    {PROJECT_TABS.map((key) => (
                        <ToggleGroupItem key={key} value={key} className="min-w-0 flex-1 text-xs">
                            <span className="truncate">{CONTEXT_KIND_LABELS[key]}</span>
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                {/* 设定分类走本地过滤，其余分类交给宿主检索；换分类即重挂载，输入框随之清空 */}
                <AiChatSearchField
                    key={tab}
                    className="w-1/2 shrink-0"
                    isSearching={tab === 'setting' ? false : query.isLoading}
                    onSubmit={tab === 'setting' ? (next): void => setSettingKeyword(next) : query.search}
                    placeholder={tab === 'setting' ? '搜索设定字段或条目' : contextSearchPlaceholderOf(tab)}
                />
            </div>
            <div className={CONTENT_HEIGHT_CLASS}>
                {tab === 'setting' ? (
                    <ProjectSettingPanel
                        dirPath={dirPath}
                        onError={onError}
                        onSubmit={submitItems}
                        isSubmitting={isSubmitting}
                        keyword={settingKeyword}
                        onKeywordChange={setSettingKeyword}
                    />
                ) : (
                    <AiChatContextItemView
                        isPlain
                        isSearchHidden
                        query={query}
                        target={target}
                        isSubmitting={isSubmitting}
                        onSubmit={submitItems}
                    />
                )}
            </div>
        </>
    )
}
