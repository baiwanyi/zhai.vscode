/**
 * 提示词增强态：管理「发起改写 → 记原文 → 回填结果 → 还原」四步，供对话与生图两处输入卡片共用。
 * 复用约定：请求本身由调用方注入（各自协议的提示口径不同），本 hook 只持有增强态与原文快照，
 * 结果套用 / 还原后的旁路动作经 onApplied / onRestored 上抛（如生图页的词条芯片），草稿回填走 restoreFrom。
 * 关键约束：结果回来时必须校验正文是否仍是发起时那一份 —— 期间继续输入或已发送清空都要丢弃结果，
 * 否则旧改写会覆盖用户新写的内容；提交给宿主的文本可由 composeSource 改写（生图页要并进角色段）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 增强态 hook 的对外依赖 */
export interface UsePromptEnhanceOptions {
    /** 当前正文：结果回来时据此判定是否仍属于这份输入 */
    value: string
    setValue: (next: string) => void
    /** 提交给宿主的文本：可与展示正文不同，缺省提交正文本身 */
    composeSource?: (value: string) => string
    /** 发起改写：失败返回 null，提示由调用方负责 */
    request: (text: string) => Promise<string | null>
    /** 结果套用后：生图页据此摘掉已并入正文的词条芯片 */
    onApplied?: (source: string) => void
    /** 还原后：生图页据此补回芯片快照 */
    onRestored?: () => void
}

/** 增强态对外暴露的状态与操作 */
export interface PromptEnhanceState {
    isEnhancing: boolean
    /** 增强前的原文：非空即处于增强态，可还原；草稿存取直接读这一项 */
    enhancedFrom: string | null
    /** 是否处于增强态：按钮据此在「增强」与「还原」之间切换 */
    isEnhanced: boolean
    enhance: () => void
    restore: () => void
    /** 用户手动编辑时调用：退出增强态，避免「还原」把新写的内容覆盖 */
    reset: () => void
    /** 草稿回填：恢复增强前的原文快照 */
    restoreFrom: (source: string | null) => void
}

export function usePromptEnhance({
    value,
    setValue,
    composeSource,
    request,
    onApplied,
    onRestored,
}: UsePromptEnhanceOptions): PromptEnhanceState {
    const [isEnhancing, setIsEnhancing] = useState(false)
    const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null)
    /** 正文最新值：请求可能跨越继续输入或发送清空，回来时用它判断结果是否还属于当前内容 */
    const valueRef = useRef(value)

    useEffect(() => {
        valueRef.current = value
    }, [value])

    const enhance = useCallback((): void => {
        const source = value.trim()
        if (source.length === 0) {
            return
        }
        setIsEnhancing(true)
        void (async (): Promise<void> => {
            try {
                const next = await request(composeSource === undefined ? source : composeSource(source))
                if (next === null || next.trim().length === 0) {
                    return
                }
                // 期间正文被改动或已发送清空：这份改写不再属于当前内容，套用会覆盖用户新写的东西
                if (valueRef.current.trim() !== source) {
                    return
                }
                setEnhancedFrom(source)
                setValue(next)
                onApplied?.(source)
            } catch {
                // 请求失败由调用方的 request 负责提示，这里只保证进行态复位
                return
            } finally {
                setIsEnhancing(false)
            }
        })()
    }, [composeSource, onApplied, request, setValue, value])

    const restore = useCallback((): void => {
        if (enhancedFrom === null) {
            return
        }
        setValue(enhancedFrom)
        setEnhancedFrom(null)
        onRestored?.()
    }, [enhancedFrom, onRestored, setValue])

    const reset = useCallback((): void => {
        setEnhancedFrom(null)
    }, [])

    const restoreFrom = useCallback((source: string | null): void => {
        setEnhancedFrom(source)
    }, [])

    return { isEnhancing, enhancedFrom, isEnhanced: enhancedFrom !== null, enhance, restore, reset, restoreFrom }
}
