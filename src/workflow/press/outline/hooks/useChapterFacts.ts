/**
 * 章节事实读取：打开「写后回填」时向宿主拉取每章的实际摘要、状态与字数。
 * 复用约定：请求走 @shared/utils/bridge 的 press/outline/facts，错误经 toastError 提示；
 * 事实只读，不写章节文件，回填写的是大纲段落。
 * 关键约束：只在对话框打开时请求，关闭即重置；切换作品要重新拉取，避免把上一部作品的章节当成当前作品。
 */
import { useCallback, useEffect, useState } from 'react'
import type { PressChapterFact, PressOutlineFactsRequest, PressOutlineFactsResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export interface ChapterFactsState {
    isLoading: boolean
    facts: PressChapterFact[]
    reload: () => void
}

export function useChapterFacts(dirPath: string, isOpen: boolean): ChapterFactsState {
    const [isLoading, setIsLoading] = useState(false)
    const [facts, setFacts] = useState<PressChapterFact[]>([])
    const [reloadToken, setReloadToken] = useState(0)

    useEffect(() => {
        if (!isOpen || dirPath.length === 0) {
            setFacts([])
            return
        }
        let isCancelled = false
        const load = async (): Promise<void> => {
            setIsLoading(true)
            try {
                const payload: PressOutlineFactsRequest = { dirPath }
                const result = await request<PressOutlineFactsResult>('press/outline/facts', payload)
                if (!isCancelled) {
                    setFacts(result.chapters)
                }
            } catch (cause) {
                if (!isCancelled) {
                    toastError(cause)
                    setFacts([])
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false)
                }
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [dirPath, isOpen, reloadToken])

    const reload = useCallback((): void => {
        setReloadToken((token) => token + 1)
    }, [])

    return { isLoading, facts, reload }
}
