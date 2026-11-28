/**
 * 公众号写操作执行器：统一「置忙 → 请求 → 重拉 → 提示 → 收尾」模板，供账号与批次 hooks 复用。
 * 复用约定：请求由调用方经 execute 注入（内部走 shared/utils/bridge），错误与提示走 shared/utils/error，
 * 重拉同样由调用方注入；每个动作只声明请求、成功提示与特殊收尾，不再重复 isMutating 与 try/catch/finally。
 * 关键约束：成功返回 execute 的结果，失败返回 undefined；取消类动作用 shouldReload 谓词跳过重拉；
 * 失败补充处理与成败皆执行的收尾分别走 onFailed / onSettled，避免打乱提示与状态复位顺序。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { toastError } from '@shared/utils/error'

export interface WechatMutationConfig<T> {
    /** 请求动作：只负责发起请求并返回结果 */
    execute: () => Promise<T>
    /** 成功提示：返回 null 表示不提示 */
    success?: (result: T) => string | null
    /** 是否重拉：默认 true，也可按结果决定（取消类动作据此跳过） */
    shouldReload?: boolean | ((result: T) => boolean)
    /** 失败后的补充处理，如失败也重拉以展示宿主写入的原因 */
    onFailed?: () => Promise<void>
    /** 无论成败都执行，如清空阶段提示 */
    onSettled?: () => void
}

export interface WechatMutationState {
    isMutating: boolean
    /** 执行写操作：成功返回 execute 的结果，失败返回 undefined */
    run: <T>(config: WechatMutationConfig<T>) => Promise<T | undefined>
}

export function useWechatMutation(reload: () => Promise<void>): WechatMutationState {
    const [isMutating, setIsMutating] = useState(false)

    const run = useCallback(
        async <T,>(config: WechatMutationConfig<T>): Promise<T | undefined> => {
            setIsMutating(true)
            try {
                const result = await config.execute()
                const shouldReload =
                    typeof config.shouldReload === 'function'
                        ? config.shouldReload(result)
                        : (config.shouldReload ?? true)
                if (shouldReload) {
                    await reload()
                }
                const message = config.success?.(result) ?? null
                if (message !== null) {
                    toast.success(message)
                }
                return result
            } catch (cause) {
                toastError(cause)
                await config.onFailed?.()
                return undefined
            } finally {
                config.onSettled?.()
                setIsMutating(false)
            }
        },
        [reload],
    )

    return { isMutating, run }
}
