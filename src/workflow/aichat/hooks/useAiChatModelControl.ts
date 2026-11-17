/**
 * AI 对话的模型控制：组合模型清单与运行时信息，给出模型菜单需要的当前值、展示名与四个选择动作。
 * 复用约定：清单拉取与选择走 ./useAiChatModels，展示名兜底取 @shared/types/aiChat 的 AiRuntimeInfo，
 * 页面与输入卡片只透传这一个控制对象，不再逐项搬 runtime / choices / 回调。
 * 关键约束：展示名只在运行时模型与当前模型一致时采用 —— 切换瞬间运行时仍是旧名称，
 * 直接采用会让菜单出现「新 id 配旧名称」；不一致时留空，由菜单改显读取指示而不是裸模型 id。
 * 空模型 id 有两种含义：运行时与清单都没到位（插件刚加载），或已就绪且用户选了自动。
 * 二者都表现为 current 为空串，故必须一并给出 isReady 让菜单区分，否则加载阶段会被误判成 Auto。
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
    /** 模型信息是否已就绪：运行时与清单都未到位时为空串 current 只是「还没读到」，不是自动模型 */
    isReady: boolean
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
    /** 两处数据源任一到位才算就绪：都缺时 current 的空串只是占位，不能当自动模型 */
    const isReady = runtime !== null || choices !== null

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
            isReady,
            choices,
            isLoading,
            open,
            select,
            selectContextWindow: selectWindow,
            selectEffort: selectReasoningEffort,
        }),
        [choices, current, currentName, isLoading, isReady, open, select, selectReasoningEffort, selectWindow],
    )
}
