/**
 * 用量列表数据源：模块、时间范围或页码变化时向宿主请求 ai/usage，返回列表、汇总与加载态。
 * 复用约定：请求经 webview 公共 bridge，错误文案由 ../utils 的 toErrorText 统一转换；
 * 分页与汇总都在宿主侧完成，前端直接用返回结果，不再二次计算。
 * 关键约束：只认最后一次请求（清理标记比对），快速切换筛选时旧响应不会写回；
 * 刷新期间保留上一份结果，避免表格闪空；卸载后不再 setState。
 */
import { useEffect, useState } from 'react'
import type { AiUsageListResult, AiUsageModule, AiUsageRange } from '@shared/types/aiUsage'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 列表 hook 的对外状态：result 为 null 表示尚未成功加载过 */
export interface AiUsageState {
    result: AiUsageListResult | null
    error: string | null
    isLoading: boolean
}

export function useAiUsage(
    module: AiUsageModule | null,
    range: AiUsageRange,
    page: number,
    pageSize: number,
): AiUsageState {
    const [result, setResult] = useState<AiUsageListResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        const run = async (): Promise<void> => {
            try {
                const payload = await request<AiUsageListResult>('ai/usage', { module, range, page, pageSize })
                if (!cancelled) {
                    setResult(payload)
                    setError(null)
                }
            } catch (cause) {
                if (!cancelled) {
                    setError(toErrorText(cause))
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }
        void run()
        return (): void => {
            cancelled = true
        }
    }, [module, page, pageSize, range])

    return { result, error, isLoading }
}
