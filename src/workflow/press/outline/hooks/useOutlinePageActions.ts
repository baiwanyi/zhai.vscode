/**
 * 大纲工作台事件编排：集中管理对话框状态与页头/卡片动作，向页面返回可直接绑定的处理器。
 * 复用约定：入参为页面已算好的选中项与写盘回调，所有落盘经 onApplyOutlineChange / onUpdatePlan 上抛；
 * AI 上下文与素材提取复用 @shared 请求层和页面传入的 extract，不在 Hook 内另起数据源。
 * 关键约束：新增节点先清筛选再选中，删除/清空后清掉失效选中；异步链统一 catch 到 toast；
 * uri 用 JSON 数组编码避免盘符冒号歧义；列表筛选 state 仍由页面持有，本 Hook 只管动作与对话框。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import type { AiContextAddInlineResult } from '@shared/types/aiChat'
import type { PressExtractedVolume } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type { CreatedOutlineNode } from '../../hooks/usePressMutations'
import type {
    OutlineExtractTarget,
    OutlineModuleKey,
    OutlinePlan,
    OutlineSectionKey,
    OutlineTreeEntry,
    OutlineVolume,
    OutlineWorkspace,
} from '../../types'
import type { OutlineExtractState } from './useOutlineExtract'
import type { Dispatch, SetStateAction } from 'react'
import {
    createAct,
    createClue,
    createGrowthPoint,
    formatChapterOutlineText,
    formatVolumeOutlineText,
    volumeTitleLabel,
} from '../../utils'

interface UseOutlinePageActionsOptions {
    workspace: OutlineWorkspace
    dirPath: string
    selectedChapterId: string | null
    selectedEntry: OutlineTreeEntry | null
    volumeFilter: string
    hasVolumeOutline: boolean
    extractState: OutlineExtractState
    setSelectedChapterId: Dispatch<SetStateAction<string | null>>
    setModule: Dispatch<SetStateAction<OutlineModuleKey>>
    setVolumeFilter: Dispatch<SetStateAction<string>>
    setQuery: Dispatch<SetStateAction<string>>
    onCreateVolume: () => CreatedOutlineNode | null
    onCreateChapter: (volumeId?: string) => CreatedOutlineNode | null
    onUpdatePlan: (section: OutlineSectionKey, patch: Partial<OutlinePlan>) => void
    onApplyOutlineChange: (next: { volumes?: OutlineVolume[]; plan?: OutlinePlan }) => void
    onExtractOutline: (drafts: PressExtractedVolume[], target: OutlineExtractTarget) => number
}

/** 页面动作集合：导出供对话框组与主体组件按对象注入，避免逐字段透传 */
export interface OutlinePageActions {
    isGenerateOpen: boolean
    setIsGenerateOpen: Dispatch<SetStateAction<boolean>>
    isOutlinesOpen: boolean
    setIsOutlinesOpen: Dispatch<SetStateAction<boolean>>
    isOutlinesConfirmOpen: boolean
    setIsOutlinesConfirmOpen: Dispatch<SetStateAction<boolean>>
    generatingVolume: OutlineVolume | null
    deletingVolume: OutlineVolume | null
    setDeletingVolumeId: Dispatch<SetStateAction<string | null>>
    deletingVolumeIndex: number
    clearingVolume: OutlineVolume | null
    setClearingVolumeId: Dispatch<SetStateAction<string | null>>
    clearingVolumeIndex: number
    handleSelectChapter: (chapterId: string) => void
    /** 跨模块跳转：切页并清章节选中，带卷 id 时同时收窄章纲列表 */
    handleOpenModule: (module: OutlineModuleKey, volumeId?: string) => void
    handleVolumeChange: (next: string) => void
    handleGenerateVolumeChapters: (volume: OutlineVolume) => void
    handleCreateVolume: () => void
    handleCreateChapter: () => void
    handleCreateAct: () => void
    handleCreateClue: () => void
    handleCreateGrowth: () => void
    handleGenerateVolumeOutlines: () => void
    handleDeleteVolume: (volume: OutlineVolume) => void
    handleClearVolumeChapters: (volume: OutlineVolume) => void
    handleMoveVolume: (volumeId: string, direction: -1 | 1) => void
    handleAddVolumeToChat: (volume: OutlineVolume, index: number) => void
    handleAddChapterToChat: () => Promise<void>
    handleConfirmDeleteVolume: () => void
    handleConfirmClearChapters: () => void
    handleExtract: (target: OutlineExtractTarget) => void
    confirmOutlinesOverwrite: () => void
}

/**
 * 新增落点：先清掉筛选再选中新节点——卷筛选下新卷不在旧选项里，搜索词也会把新章挡在列表外。
 * 清筛选后新章必然在树中可见。
 */
function applyCreatedNode(
    created: CreatedOutlineNode | null,
    setVolumeFilter: Dispatch<SetStateAction<string>>,
    setQuery: Dispatch<SetStateAction<string>>,
    setModule: Dispatch<SetStateAction<OutlineModuleKey>>,
    setSelectedChapterId: Dispatch<SetStateAction<string | null>>,
): void {
    if (created === null) {
        return
    }
    setVolumeFilter('all')
    setQuery('')
    setModule('chapter')
    if (created.chapterId !== null) {
        setSelectedChapterId(created.chapterId)
    }
}

export function useOutlinePageActions({
    workspace,
    dirPath,
    selectedChapterId,
    selectedEntry,
    volumeFilter,
    hasVolumeOutline,
    extractState,
    setSelectedChapterId,
    setModule,
    setVolumeFilter,
    setQuery,
    onCreateVolume,
    onCreateChapter,
    onUpdatePlan,
    onApplyOutlineChange,
    onExtractOutline,
}: UseOutlinePageActionsOptions): OutlinePageActions {
    const [isGenerateOpen, setIsGenerateOpen] = useState(false)
    const [isOutlinesOpen, setIsOutlinesOpen] = useState(false)
    const [isOutlinesConfirmOpen, setIsOutlinesConfirmOpen] = useState(false)
    const [generatingVolumeId, setGeneratingVolumeId] = useState<string | null>(null)
    const [deletingVolumeId, setDeletingVolumeId] = useState<string | null>(null)
    const [clearingVolumeId, setClearingVolumeId] = useState<string | null>(null)

    const generatingVolume = workspace.volumes.find((volume) => volume.id === generatingVolumeId) ?? null
    const deletingVolumeIndex = workspace.volumes.findIndex((volume) => volume.id === deletingVolumeId)
    const deletingVolume = workspace.volumes[deletingVolumeIndex] ?? null
    const clearingVolumeIndex = workspace.volumes.findIndex((volume) => volume.id === clearingVolumeId)
    const clearingVolume = workspace.volumes[clearingVolumeIndex] ?? null

    /** 列表点章进入详情 */
    const handleSelectChapter = (chapterId: string): void => {
        setSelectedChapterId(chapterId)
    }

    /** 卷末统计等只读汇总的跳转入口：只切视图与卷筛选，不改任何数据 */
    const handleOpenModule = (next: OutlineModuleKey, volumeId?: string): void => {
        setModule(next)
        setSelectedChapterId(null)
        if (volumeId !== undefined) {
            setVolumeFilter(volumeId)
        }
    }

    /**
     * 页头切卷：卷筛选只作用于章纲页，因此切卷同时进入章纲页并清掉章节选中，
     * 避免停留在上一卷的章上；选「全部卷」只清筛选，仍停在章纲页。
     */
    const handleVolumeChange = (next: string): void => {
        setVolumeFilter(next)
        setSelectedChapterId(null)
        setModule('chapter')
    }

    const handleGenerateVolumeChapters = (volume: OutlineVolume): void => {
        setGeneratingVolumeId(volume.id)
        setIsGenerateOpen(true)
    }

    /** 新增卷：落点是卷纲页的新卡片，不跟随首章跳到章纲；切到卷纲模块并清掉搜索词 */
    const handleCreateVolume = (): void => {
        if (onCreateVolume() === null) {
            return
        }
        setModule('volume')
        setQuery('')
    }

    /** 新增章节：优先跟随卷筛选，其次跟随用户主动选中的章所在卷；两者都没有时由数据层落末卷 */
    const handleCreateChapter = (): void => {
        if (volumeFilter !== 'all') {
            applyCreatedNode(onCreateChapter(volumeFilter), setVolumeFilter, setQuery, setModule, setSelectedChapterId)
            return
        }
        applyCreatedNode(
            onCreateChapter(selectedChapterId === null ? undefined : selectedEntry?.volume.id),
            setVolumeFilter,
            setQuery,
            setModule,
            setSelectedChapterId,
        )
    }

    const handleCreateAct = (): void => {
        const acts = [...workspace.plan.acts, createAct()]
        onUpdatePlan('structure', { acts })
    }

    const handleCreateClue = (): void => {
        const clues = [...workspace.plan.clues, createClue()]
        onUpdatePlan('clues', { clues })
    }

    /** 新增成长节点：只作回填之外的兜底入口，默认主角、卷级、空值，由作者在编辑弹窗里补全 */
    const handleCreateGrowth = (): void => {
        const growth = [...workspace.plan.growth, createGrowthPoint()]
        onUpdatePlan('growth', { growth })
    }

    /** 生成卷纲入口：已有卷纲先确认覆盖，避免一键抹掉手写内容；章节不受影响 */
    const handleGenerateVolumeOutlines = (): void => {
        if (hasVolumeOutline) {
            setIsOutlinesConfirmOpen(true)
            return
        }
        setIsOutlinesOpen(true)
    }

    const confirmOutlinesOverwrite = (): void => {
        setIsOutlinesConfirmOpen(false)
        setIsOutlinesOpen(true)
    }

    const handleDeleteVolume = (volume: OutlineVolume): void => {
        setDeletingVolumeId(volume.id)
    }

    const handleClearVolumeChapters = (volume: OutlineVolume): void => {
        setClearingVolumeId(volume.id)
    }

    /** 上移 / 下移：只调整卷顺序——卷号由位置推导，顺序变了卷号随之变化 */
    const handleMoveVolume = (volumeId: string, direction: -1 | 1): void => {
        const index = workspace.volumes.findIndex((volume) => volume.id === volumeId)
        const target = index + direction
        if (index < 0 || target < 0 || target >= workspace.volumes.length) {
            return
        }
        const next = [...workspace.volumes]
        const [moved] = next.splice(index, 1)
        if (moved === undefined) {
            return
        }
        next.splice(target, 0, moved)
        onApplyOutlineChange({ volumes: next })
    }

    /**
     * 添加到 AI 对话：把卷纲快照作为内联上下文交给宿主，宿主生成 Badge 引用并切到对话分区。
     * 关键约束：上下文芯片由宿主维护；uri 按 JSON 数组编码作品目录与卷 id，避免盘符冒号歧义。
     */
    const handleAddVolumeToChat = (volume: OutlineVolume, index: number): void => {
        const run = async (): Promise<void> => {
            try {
                await request<AiContextAddInlineResult>('ai/context/addInline', {
                    label: `${workspace.setting.title.trim() || '未命名作品'}·卷纲·${volumeTitleLabel(volume.name, index)}`,
                    text: formatVolumeOutlineText(volume, index),
                    uri: JSON.stringify(['press-outline', dirPath, volume.id]),
                    scope: dirPath,
                })
            } catch (cause) {
                toastError(cause)
            }
        }
        void run()
    }

    /**
     * 添加章纲到 AI 对话：把当前章及所属卷纲的快照交给宿主，由对话完成正文生成。
     * 关键约束：uri 按 JSON 数组编码作品目录与章 id，与卷纲引用各自去重；只注入计划内容，不混入正文事实；
     * 出场人物与题材风格一并注入，与面板「本次引用」清单逐项对应。
     */
    const handleAddChapterToChat = async (): Promise<void> => {
        if (selectedEntry === null) {
            return
        }
        const { volume, chapter } = selectedEntry
        const volumeIndex = workspace.volumes.findIndex((item) => item.id === volume.id)
        const safeIndex = volumeIndex < 0 ? 0 : volumeIndex
        try {
            await request<AiContextAddInlineResult>('ai/context/addInline', {
                label: `${workspace.setting.title.trim() || '未命名作品'}·章纲·${volumeTitleLabel(volume.name, safeIndex)}·第${String(chapter.order)}章 ${chapter.title.trim() || '未命名'}`,
                text: `${formatVolumeOutlineText(volume, safeIndex)}\n\n${formatChapterOutlineText(chapter, workspace.characters, workspace.setting, workspace.lore)}`,
                uri: JSON.stringify(['press-outline', dirPath, 'chapter', chapter.id]),
                scope: dirPath,
                kind: 'chapterOutline',
            })
        } catch (cause) {
            toastError(cause)
        }
    }

    const handleConfirmDeleteVolume = (): void => {
        if (deletingVolume === null) {
            return
        }
        onApplyOutlineChange({
            volumes: workspace.volumes.filter((volume) => volume.id !== deletingVolume.id),
        })
        setDeletingVolumeId(null)
        setSelectedChapterId(null)
    }

    const handleConfirmClearChapters = (): void => {
        if (clearingVolume === null) {
            return
        }
        onApplyOutlineChange({
            volumes: workspace.volumes.map((volume) =>
                volume.id === clearingVolume.id ? { ...volume, chapters: [] } : volume,
            ),
        })
        setClearingVolumeId(null)
        setSelectedChapterId(null)
    }

    /** 提取：target 决定整树覆盖还是刷新指定章；素材都是全量解析，范围只影响写入 */
    const handleExtract = (target: OutlineExtractTarget): void => {
        const run = async (): Promise<void> => {
            const result = await extractState.extract()
            if (result === null) {
                return
            }
            if (result.volumes.length === 0) {
                toast.info(result.message)
                return
            }
            const written = onExtractOutline(result.volumes, target)
            if (target.mode === 'all') {
                // 重建后的卷章 id 全部换新，旧选中项已失效，回到默认的首章
                setSelectedChapterId(null)
                toast.success(`${result.message}，已替换当前大纲（${String(written)} 章）`)
                return
            }
            // 范围提取不改动章 id，选中项可以保留
            if (written === 0) {
                toast.info('所选卷章在大纲里没有对应位置：确认大纲卷名带「第N卷」，或先用全篇重建')
                return
            }
            toast.success(`${result.message}，已刷新 ${String(written)} 章章纲`)
        }
        void run().catch(toastError)
    }

    return {
        isGenerateOpen,
        setIsGenerateOpen,
        isOutlinesOpen,
        setIsOutlinesOpen,
        isOutlinesConfirmOpen,
        setIsOutlinesConfirmOpen,
        generatingVolume,
        deletingVolume,
        setDeletingVolumeId,
        deletingVolumeIndex,
        clearingVolume,
        setClearingVolumeId,
        clearingVolumeIndex,
        handleSelectChapter,
        handleOpenModule,
        handleVolumeChange,
        handleGenerateVolumeChapters,
        handleCreateVolume,
        handleCreateChapter,
        handleCreateAct,
        handleCreateClue,
        handleCreateGrowth,
        handleGenerateVolumeOutlines,
        handleDeleteVolume,
        handleClearVolumeChapters,
        handleMoveVolume,
        handleAddVolumeToChat,
        handleAddChapterToChat,
        handleConfirmDeleteVolume,
        handleConfirmClearChapters,
        handleExtract,
        confirmOutlinesOverwrite,
    }
}
