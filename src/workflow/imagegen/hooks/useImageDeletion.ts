/**
 * 生图页删除编排：单张删除、批量删除（含二次确认与进度）与删除后的收尾动作。
 * 复用约定：删除请求由 useImageLibrary 注入，角色封面回退走 useCharacterCoverSync，
 * 选中集合与退出多选走 useImageSelection，本 hook 只负责串流程。
 * 关键约束：批量删除只处理「当前筛选结果内的勾选」——勾选可能发生在更早的筛选下，
 * 不应波及此刻不可见的图；提交期间以 removingTotal 防重入并兼作进度；
 * 请求级失败（removals 为空）时保留多选与勾选，让用户可直接重试。
 */
import { useState } from 'react'
import type { ImageDeleteResult, PressImageItem } from '@shared/types/imagegen'
import type { ImageBatchRemoval } from './useImageLibrary'

interface UseImageDeletionParams {
    removeImage: (image: PressImageItem) => Promise<ImageDeleteResult | null>
    removeImages: (images: PressImageItem[]) => Promise<ImageBatchRemoval>
    /** 当前筛选结果：批量删除的范围 */
    filtered: ReadonlyArray<PressImageItem>
    /** 当前生效的选中集合（已按筛选签名归零过） */
    selectedPaths: ReadonlySet<string>
    /** 退出多选并清空勾选：批量删除成功后收尾 */
    exitSelecting: () => void
    /** 详情面板正在查看的图片：删到它时关闭面板 */
    detailImage: PressImageItem | null
    onDetailRemoved: () => void
    /** 角色封面回退 */
    syncAfterDelete: (characterId: string | null, deletedId: string, nextPortraitId: string | null) => void
    syncAfterBatchDelete: (removed: ReadonlyArray<PressImageItem>, remaining: ReadonlyArray<PressImageItem>) => void
}

interface UseImageDeletionResult {
    /** 批量删除中的张数：非空表示正在删除，同时用于禁用重复触发 */
    removingTotal: number | null
    /** 批量删除的二次确认：一次删多张比单张更需要拦一下 */
    isConfirmingBatch: boolean
    deleteOne: (image: PressImageItem) => Promise<void>
    deleteSelected: () => Promise<void>
    /** 请求批量删除：只打开二次确认，真正的删除在确认后执行 */
    requestConfirm: () => void
    /** 确认框开关：打开由标题行触发，关闭一律回到未确认态 */
    closeConfirm: () => void
    /** 确认批量删除：先收起弹窗再提交，避免删除过程中弹窗仍压在列表上 */
    confirmBatch: () => void
}

export function useImageDeletion({
    removeImage,
    removeImages,
    filtered,
    selectedPaths,
    exitSelecting,
    detailImage,
    onDetailRemoved,
    syncAfterDelete,
    syncAfterBatchDelete,
}: UseImageDeletionParams): UseImageDeletionResult {
    const [removingTotal, setRemovingTotal] = useState<number | null>(null)
    const [isConfirmingBatch, setIsConfirmingBatch] = useState(false)

    const deleteOne = async (image: PressImageItem): Promise<void> => {
        const result = await removeImage(image)
        // 删掉的可能正是详情面板里的那张，面板随之关闭，避免停留在一个已不存在的文件上
        if (detailImage !== null && detailImage.path === image.path) {
            onDetailRemoved()
        }
        if (result === null || !result.removed) {
            return
        }
        syncAfterDelete(result.characterId, image.id, result.nextPortraitId)
    }

    const deleteSelected = async (): Promise<void> => {
        if (removingTotal !== null) {
            return
        }
        const targets = filtered.filter((image) => selectedPaths.has(image.path))
        if (targets.length === 0) {
            return
        }
        setRemovingTotal(targets.length)
        try {
            const { removals, images: remaining } = await removeImages(targets)
            const removed = removals.filter((item) => item.removed).map((item) => item.image)
            if (detailImage !== null && removed.some((image) => image.id === detailImage.id)) {
                onDetailRemoved()
            }
            // 请求级失败（removals 为空）时保留多选与勾选，用户可直接重试
            if (removals.length > 0) {
                exitSelecting()
            }
            syncAfterBatchDelete(removed, remaining)
        } finally {
            setRemovingTotal(null)
        }
    }

    const requestConfirm = (): void => {
        setIsConfirmingBatch(true)
    }

    const closeConfirm = (): void => {
        setIsConfirmingBatch(false)
    }

    const confirmBatch = (): void => {
        setIsConfirmingBatch(false)
        void deleteSelected()
    }

    return { removingTotal, isConfirmingBatch, deleteOne, deleteSelected, requestConfirm, closeConfirm, confirmBatch }
}
