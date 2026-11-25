/**
 * 大纲视图派生数据：把原始工作区按选中项、卷筛选与搜索词收窄成页面与各面板可用的只读快照。
 * 复用约定：卷选项、伏笔预警、章节引用、统计与生成上下文一律复用 ../utils 既有纯函数，不重复实现口径；
 * 入参只收工作区与视图条件，写盘与选中副作用仍由页面及 useOutlinePageActions 承担。
 * 关键约束：entries 为全量树，treeEntries 仅收窄列表、不影响详情解析；generatingVolume 为空时生成上下文为空数组；
 * 卷筛选取值用卷 id 而非卷名，标题搜索按 chapterTitleLabel 口径，避免与展示层脱节。
 */
import { useMemo } from 'react'
import type { OutlineTreeEntry, OutlineWorkspace } from '../../types'
import {
    chapterTitleLabel,
    createChapterRefEntries,
    createChapterRefOptions,
    createVolumeOptions,
    findClueWarnings,
    readOutlineVolumeOrder,
    summarizeWorkspace,
    toOutlineActContexts,
    volumeTitleLabel,
} from '../../utils'

interface UseOutlineDerivedOptions {
    workspace: OutlineWorkspace
    selectedChapterId: string | null
    volumeFilter: string
    query: string
}

export function useOutlineDerived({
    workspace,
    selectedChapterId,
    volumeFilter,
    query,
}: UseOutlineDerivedOptions): {
    entries: OutlineTreeEntry[]
    selectedEntry: OutlineTreeEntry | null
    summary: ReturnType<typeof summarizeWorkspace>
    donePercent: number
    volumeOptions: ReturnType<typeof createVolumeOptions>
    clueWarnings: ReturnType<typeof findClueWarnings>
    refOptions: ReturnType<typeof createChapterRefOptions>
    refEntries: ReturnType<typeof createChapterRefEntries>
    actVolumeOptions: { value: string; label: string }[]
    treeEntries: OutlineTreeEntry[]
    hasVolumeOutline: boolean
    actContexts: ReturnType<typeof toOutlineActContexts>
} {
    const plan = workspace.plan
    const entries = useMemo(
        () => workspace.volumes.flatMap((volume) => volume.chapters.map((chapter) => ({ volume, chapter }))),
        [workspace.volumes],
    )
    const selectedEntry = entries.find((entry) => entry.chapter.id === selectedChapterId) ?? entries.at(0) ?? null
    const summary = useMemo(() => summarizeWorkspace(workspace.volumes), [workspace.volumes])
    const donePercent = summary.chapters > 0 ? Math.round((summary.done / summary.chapters) * 100) : 0
    /** 卷筛选选项：取值用卷 id，卷名允许重名 */
    const volumeOptions = useMemo(() => createVolumeOptions(workspace.volumes), [workspace.volumes])
    /** 伏笔预警：按最后一个「已写」章位置判断逾期与临期 */
    const clueWarnings = useMemo(() => findClueWarnings(plan, workspace.volumes), [plan, workspace.volumes])
    /** 章节引用选项与条目：伏笔下拉与聚焦视图共用 */
    const refOptions = useMemo(() => createChapterRefOptions(workspace.volumes), [workspace.volumes])
    const refEntries = useMemo(() => createChapterRefEntries(workspace.volumes), [workspace.volumes])
    /** 卷位选项：结构阶段按卷序定位，与伏笔的引用口径一致 */
    const actVolumeOptions = useMemo(
        () =>
            workspace.volumes.map((volume, index) => ({
                value: String(readOutlineVolumeOrder(volume.name, index)),
                label: volumeTitleLabel(volume.name, index),
            })),
        [workspace.volumes],
    )
    /** 章节列表展示项：卷筛选与标题搜索只收窄列表，详情与选中项仍按全量 entries 解析 */
    const treeEntries = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        return entries.filter((entry) => {
            if (volumeFilter !== 'all' && entry.volume.id !== volumeFilter) {
                return false
            }
            if (keyword.length === 0) {
                return true
            }
            return chapterTitleLabel(entry.chapter).toLowerCase().includes(keyword)
        })
    }, [entries, query, volumeFilter])
    /** 卷纲是否已有内容：任一卷填了核心事件 / 主要情节 / 转折 / 卷末结果，就视为需要确认覆盖 */
    const hasVolumeOutline = useMemo(
        () =>
            workspace.volumes.some(
                (volume) =>
                    volume.coreEvent.trim().length > 0 ||
                    volume.mainPlot.length > 0 ||
                    volume.turningPoints.length > 0 ||
                    volume.result.trim().length > 0,
            ),
        [workspace.volumes],
    )
    /** 全书结构约束：按卷序分组的阶段列表，供生成对话框与结构面板共用 */
    const actContexts = useMemo(() => toOutlineActContexts(plan.acts), [plan.acts])

    return {
        entries,
        selectedEntry,
        summary,
        donePercent,
        volumeOptions,
        clueWarnings,
        refOptions,
        refEntries,
        actVolumeOptions,
        treeEntries,
        hasVolumeOutline,
        actContexts,
    }
}
