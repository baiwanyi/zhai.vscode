/**
 * 回填勾选状态：持有章节勾选、伏笔勾选、已采纳的伏笔建议键与成长节点建议键，统一提供切换与复位入口。
 * 复用约定：章节默认全选用 null 表示，事实刷新后自动跟随；用户主动取消后才落成明确数组；
 * 全部更新走函数式 setState，避免连续切换时读到过时快照。
 * 关键约束：reset 一次清空四份状态，供关闭对话框与提交后复用；本 Hook 不读 hook 外部状态、不写盘。
 */
import { useCallback, useState } from 'react'
import type { BackfillRow } from '../utils/backfill'

export interface BackfillState {
    selection: string[] | null
    clueSelection: string[]
    acceptedRefKeys: string[]
    /** 已采纳的成长节点建议键：键形如 `track:卷序-章序` */
    acceptedGrowthKeys: string[]
    selectedChapterIds: (rows: readonly BackfillRow[]) => string[]
    toggleChapter: (chapterId: string, rows: readonly BackfillRow[]) => void
    toggleClue: (clueId: string) => void
    toggleRef: (key: string) => void
    toggleGrowth: (key: string) => void
    acceptAll: (keys: string[]) => void
    acceptAllGrowth: (keys: string[]) => void
    reset: () => void
}

export function useBackfillState(): BackfillState {
    const [selection, setSelection] = useState<string[] | null>(null)
    const [clueSelection, setClueSelection] = useState<string[]>([])
    const [acceptedRefKeys, setAcceptedRefKeys] = useState<string[]>([])
    const [acceptedGrowthKeys, setAcceptedGrowthKeys] = useState<string[]>([])

    const selectedChapterIds = useCallback(
        (rows: readonly BackfillRow[]): string[] => selection ?? rows.map((row) => row.chapter.id),
        [selection],
    )

    const toggleChapter = useCallback((chapterId: string, rows: readonly BackfillRow[]): void => {
        setSelection((previous) => {
            const current = previous ?? rows.map((row) => row.chapter.id)
            return current.includes(chapterId) ? current.filter((id) => id !== chapterId) : [...current, chapterId]
        })
    }, [])

    const toggleClue = useCallback((clueId: string): void => {
        setClueSelection((previous) =>
            previous.includes(clueId) ? previous.filter((id) => id !== clueId) : [...previous, clueId],
        )
    }, [])

    const toggleRef = useCallback((key: string): void => {
        setAcceptedRefKeys((previous) =>
            previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key],
        )
    }, [])

    const toggleGrowth = useCallback((key: string): void => {
        setAcceptedGrowthKeys((previous) =>
            previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key],
        )
    }, [])

    const acceptAll = useCallback((keys: string[]): void => {
        setAcceptedRefKeys(keys)
    }, [])

    const acceptAllGrowth = useCallback((keys: string[]): void => {
        setAcceptedGrowthKeys(keys)
    }, [])

    const reset = useCallback((): void => {
        setSelection(null)
        setClueSelection([])
        setAcceptedRefKeys([])
        setAcceptedGrowthKeys([])
    }, [])

    return {
        selection,
        clueSelection,
        acceptedRefKeys,
        acceptedGrowthKeys,
        selectedChapterIds,
        toggleChapter,
        toggleClue,
        toggleRef,
        toggleGrowth,
        acceptAll,
        acceptAllGrowth,
        reset,
    }
}
