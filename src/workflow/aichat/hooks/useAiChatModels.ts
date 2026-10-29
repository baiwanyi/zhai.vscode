/**
 * AI 对话模型菜单数据：经宿主 ai/models 按需拉取账号可用模型与当前选择，ai/selectModel 写回选择结果，
 * ai/selectContextWindow 写回上下文档位（0 表示跟随模型默认）。
 * 清单拉取需拉起 CLI 子进程（数秒），故只在菜单展开时加载，并复用同一次进行中的请求；
 * 选择成功后由宿主广播运行时变更，本层只同步菜单内的当前值，不重复拉取运行时信息。
 * 关键约束：拉清单的超时上限高于默认值；选择只回传模型 id 与 manual 标记，不传展示名；
 * 档位是否合法由宿主按模型清单裁决，前端只做点击透传，不做本地白名单。
 */
import { useCallback, useRef, useState } from 'react'
import type { AiModelChoices } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '../utils'

/** 模型清单请求的超时上限：拉起 CLI 比普通请求慢，默认 10 秒不够 */
const MODELS_TIMEOUT_MS = 30_000

/** 模型菜单 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatModelsOptions {
    onError: (error: string | null) => void
}

/** 模型菜单对外暴露的状态与操作 */
export interface AiChatModelsState {
    choices: AiModelChoices | null
    isLoading: boolean
    loadModels: () => Promise<void>
    selectModel: (modelId: string, manual: boolean) => Promise<boolean>
    /** 选择上下文档位：0 表示跟随模型默认 */
    selectContextWindow: (tokens: number) => Promise<boolean>
}

export function useAiChatModels({ onError }: UseAiChatModelsOptions): AiChatModelsState {
    const [choices, setChoices] = useState<AiModelChoices | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    /** 进行中的清单请求：重复展开菜单时复用，避免并发拉起多个 CLI */
    const inflightRef = useRef<Promise<void> | null>(null)

    const loadModels = useCallback((): Promise<void> => {
        const inflight = inflightRef.current
        if (inflight !== null) {
            return inflight
        }
        setIsLoading(true)
        const task = request<AiModelChoices>('ai/models', undefined, MODELS_TIMEOUT_MS)
            .then((result) => {
                setChoices(result)
            })
            .catch((cause: unknown) => {
                onError(toErrorText(cause))
            })
            .finally(() => {
                inflightRef.current = null
                setIsLoading(false)
            })
        inflightRef.current = task
        return task
    }, [onError])

    /** 选择模型：空 id 表示恢复 CLI 默认；manual 为 true 时由宿主弹出输入框，返回是否发生变更 */
    const selectModel = useCallback(
        async (modelId: string, manual: boolean): Promise<boolean> => {
            try {
                const result = await request<{ modelId: string; changed: boolean }>('ai/selectModel', {
                    modelId,
                    manual,
                })
                if (result.changed) {
                    setChoices((previous) => (previous === null ? previous : { ...previous, current: result.modelId }))
                }
                return result.changed
            } catch (cause) {
                onError(toErrorText(cause))
                return false
            }
        },
        [onError],
    )

    /** 选择上下文档位：宿主校验通过后回传生效值，本层同步菜单当前档位 */
    const selectContextWindow = useCallback(
        async (tokens: number): Promise<boolean> => {
            try {
                const result = await request<{ contextWindow: number; changed: boolean }>('ai/selectContextWindow', {
                    tokens,
                })
                if (result.changed) {
                    setChoices((previous) =>
                        previous === null ? previous : { ...previous, contextWindow: result.contextWindow },
                    )
                }
                return result.changed
            } catch (cause) {
                onError(toErrorText(cause))
                return false
            }
        },
        [onError],
    )

    return { choices, isLoading, loadModels, selectModel, selectContextWindow }
}
