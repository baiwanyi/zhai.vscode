/**
 * 仪表盘动作执行基础设施：宿主请求的失败提示归一，以及批量动作的结果提示。
 * 复用 @shared/utils/bridge 的 request 与 @shared/utils/error 的 toErrorText，文案由 ../utils 的纯函数推导。
 * 关键约束：请求失败一律提示并返回 null，调用方据此判定整单失败——因此要求宿主成功响应的载荷不为 null；
 * 批量结果只提示一次（成功条数 + 首条失败原因），避免逐条刷屏。
 */
import { toast } from 'sonner'
import type { HostMethodName } from '@shared/types/messages'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import type { BatchOutcomeOptions } from '../utils'
import { readBatchOutcome } from '../utils'

/** 发一次宿主请求：成功返回载荷，失败提示并返回 null */
export async function callHostRequest<R>(method: HostMethodName, payload?: unknown): Promise<R | null> {
    try {
        return await request<R>(method, payload)
    } catch (cause) {
        toast.error(toErrorText(cause))
        return null
    }
}

/** 上报批量动作结果：成功与失败各自一条提示，没有对应结果时不发提示 */
export function notifyBatchOutcome(options: BatchOutcomeOptions): void {
    const outcome = readBatchOutcome(options)
    if (outcome.success !== null) {
        toast.success(outcome.success)
    }
    if (outcome.failure !== null) {
        toast.error(outcome.failure)
    }
}
