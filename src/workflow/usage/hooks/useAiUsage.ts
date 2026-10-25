/**
 * 用量列表数据源：模块、时间范围或页码变化时向宿主请求 ai/usage，返回列表、汇总、加载态与手动刷新。
 * 复用约定：请求经 @shared/utils/bridge，错误文案由 ../utils 的 toErrorText 统一转换；
 * 分页与汇总都在宿主侧完成，前端直接用返回结果，不再二次计算。
 * 关键约束：只认最后一次请求（清理标记比对），快速切换筛选时旧响应不会写回；刷新期间保留上一份结果，
 * 避免表格闪空；只有手动刷新带 force 跳过节流，页面可见时的 30 秒静默同步走普通查询。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AiUsageListResult, AiUsageModule, AiUsageRange } from '@shared/types/aiUsage'
import { request } from '@shared/utils/bridge'
import { POLL_INTERVAL_MS } from '../constants'
import { toErrorText } from '../utils'

/** 一次请求的版本与是否强制重扫：版本变更触发 effect，force 原样透传宿主 */
interface UsageRequest {
    version: number
    force: boolean
}

/** 列表 hook 的对外状态：result 为 null 表示尚未成功加载过 */
export interface AiUsageState {
    result: AiUsageListResult | null
    error: string | null
    isLoading: boolean
    /** 手动刷新：跳过节流，立即重扫 CodeBuddy 会话记录 */
    refresh: () => void
}

export function useAiUsage(
    module: AiUsageModule | null,
    range: AiUsageRange,
    page: number,
    pageSize: number,
): AiUsageState {
    const [result, setResult] = useState<AiUsageListResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [requestState, setRequestState] = useState<UsageRequest>({ version: 0, force: false })
    const [completedVersion, setCompletedVersion] = useState(-1)

    useEffect(() => {
        let cancelled = false
        const run = async (): Promise<void> => {
            try {
                const payload = await request<AiUsageListResult>('ai/usage', {
                    module,
                    range,
                    page,
                    pageSize,
                    force: requestState.force,
                })
                if (!cancelled) {
                    setResult(payload)
                    setError(null)
                    // 只有手动刷新才提示：轮询与翻页静默完成，不打扰阅读
                    if (requestState.force) {
                        toast.success('用量已刷新')
                    }
                }
            } catch (cause) {
                if (!cancelled) {
                    setError(toErrorText(cause))
                }
            } finally {
                if (!cancelled) {
                    setCompletedVersion(requestState.version)
                }
            }
        }
        void run()
        return (): void => {
            cancelled = true
        }
    }, [module, page, pageSize, range, requestState])

    // 页面可见时静默同步：补齐刚结束的轮次；标签页隐藏或面板失焦时不发请求
    useEffect(() => {
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                setRequestState((prev) => ({ version: prev.version + 1, force: false }))
            }
        }, POLL_INTERVAL_MS)
        return (): void => {
            clearInterval(timer)
        }
    }, [])

    const refresh = useCallback((): void => {
        setRequestState((prev) => ({ version: prev.version + 1, force: true }))
    }, [])

    return { result, error, isLoading: requestState.version !== completedVersion, refresh }
}
