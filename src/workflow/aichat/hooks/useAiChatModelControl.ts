/**
 * AI 对话的模型控制：组合模型清单与运行时信息，给出模型菜单需要的当前值、展示名与四个选择动作。
 * 复用约定：清单拉取与选择走 ./useAiChatModels，展示名兜底取 @shared/types/aiChat 的 AiRuntimeInfo，
 * 页面与输入卡片只透传这一个控制对象，不再逐项搬 runtime / choices / 回调。
 * 关键约束：展示名只在运行时模型与当前模型一致时采用 —— 切换瞬间运行时仍是旧名称，
 * 直接采用会让菜单出现「新 id 配旧名称」；不一致时留空，由菜单退回展示 id。
 */
import { useCallback, useMemo } from 'react'
import type { AiModelChoices, AiReasoningEffort, AiRuntimeInfo } from '@shared/types/aiChat'
import { useAiChatModels } from './useAiChatModels'

/** 模型控制 hook 的对外依赖：运行时由页面提供，错误经 onError 统一提示 */
export interface UseAiChatModelControlOptions {
    /** 运行时信息：当前模型 id 与展示名的兜底来源 */
    runtime: AiRuntimeInfo | null
    onError: (error: string | null) => void
}

/** 模型控制对外暴露的状态与操作：输入卡片与模型菜单共用同一份 */
export interface AiChatModelControl {
    /** 当前模型 id，空表示使用 CLI 默认模型 */
    current: string
    /** 当前模型展示名：清单未拉取时由运行时提供，空串表示未知 */
    currentName: string
    /** 菜单数据：未展开过时为 null */
    choices: AiModelChoices | null
    /** 清单拉取中：菜单据此展示加载态并丢弃重复展开 */
    isLoading: boolean
    /** 展开菜单时拉取清单（进行中的请求会被复用） */
    open: () => void
    select: (modelId: string) => void
    /** 选择上下文档位：0 表示跟随模型默认 */
    selectContextWindow: (tokens: number) => void
    /** 选择推理强度：null 表示跟随模型默认 */
    selectEffort: (effort: AiReasoningEffort | null) => void
}

export function useAiChatModelControl({ runtime, onError }: UseAiChatModelControlOptions): AiChatModelControl {
    const { choices, isLoading, loadModels, selectModel, selectContextWindow, selectEffort } = useAiChatModels({
        onError,
    })

    /** 当前模型：菜单展开过时以菜单数据为准，否则用运行时带回的模型 id 兜底 */
    const current = choices?.current ?? runtime?.model ?? ''
    /** 展示名与当前模型对齐后才采用，避免切换瞬间出现「新 id 配旧名称」 */
    const currentName = runtime !== null && runtime.model === current ? runtime.modelName : ''

    const open = useCallback((): void => {
        void loadModels()
    }, [loadModels])

    const select = useCallback(
        (modelId: string): void => {
            void selectModel(modelId)
        },
        [selectModel],
    )

    const selectWindow = useCallback(
        (tokens: number): void => {
            void selectContextWindow(tokens)
        },
        [selectContextWindow],
    )

    const selectReasoningEffort = useCallback(
        (effort: AiReasoningEffort | null): void => {
            void selectEffort(effort)
        },
        [selectEffort],
    )

    return useMemo(
        () => ({
            current,
            currentName,
            choices,
            isLoading,
            open,
            select,
            selectContextWindow: selectWindow,
            selectEffort: selectReasoningEffort,
        }),
        [choices, current, currentName, isLoading, open, select, selectReasoningEffort, selectWindow],
    )
}
