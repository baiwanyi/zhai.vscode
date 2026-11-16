/**
 * AI 对话检索弹窗的开关与选中收尾：接管「打开 → 检索 → 选中成功则关闭并清空候选 → 关闭即清空」这套语义，
 * 候选、检索态与添加动作仍由各自的检索 hook 持有，本 hook 只补一层弹窗状态。
 * 复用约定：items / search / add / reset 由调用方注入（提及与参考资料两个检索 hook 形状一致），
 * 选中成功与否以 add 的返回值为准，失败时保持弹窗打开，让用户换一个候选。
 * 关键约束：本层不缓存候选、不吞错误（错误由检索 hook 的 onError 统一提示）；
 * 关闭一律清空候选，避免下次打开先闪出上一次的检索结果。
 */
import { useCallback, useMemo, useState } from 'react'

/** 检索弹窗 hook 的对外依赖：全部来自调用方的检索 hook */
export interface UseAiChatPickerOptions<T> {
    /** 候选列表 */
    items: readonly T[]
    /** 检索进行中：弹窗据此展示加载态并禁用检索按钮 */
    isSearching: boolean
    /** 提交检索关键词 */
    search: (keyword: string) => Promise<void>
    /** 添加候选为上下文：返回是否成功 */
    add: (item: T) => Promise<boolean>
    /** 清空候选：关闭与选中成功后都会调用 */
    reset: () => void
}

/** 检索弹窗对外暴露的状态与操作 */
export interface AiChatPickerControls<T> {
    isOpen: boolean
    items: readonly T[]
    isSearching: boolean
    open: () => void
    close: () => void
    search: (keyword: string) => Promise<void>
    /** 选中候选：成功后关闭并清空候选，返回是否添加成功 */
    pick: (item: T) => Promise<boolean>
}

export function useAiChatPicker<T>({
    items,
    isSearching,
    search,
    add,
    reset,
}: UseAiChatPickerOptions<T>): AiChatPickerControls<T> {
    const [isOpen, setIsOpen] = useState(false)

    const open = useCallback((): void => {
        setIsOpen(true)
    }, [])

    const close = useCallback((): void => {
        setIsOpen(false)
        reset()
    }, [reset])

    /** 选中即收尾：添加成功才关闭，失败保持打开便于重选 */
    const pick = useCallback(
        async (item: T): Promise<boolean> => {
            const isAdded = await add(item)
            if (isAdded) {
                close()
            }
            return isAdded
        },
        [add, close],
    )

    return useMemo(
        () => ({ isOpen, items, isSearching, open, close, search, pick }),
        [close, isOpen, isSearching, items, open, pick, search],
    )
}
