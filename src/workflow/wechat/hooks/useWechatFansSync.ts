/**
 * 同步命令：把触发、进度提示与结果反馈收敛为页面可直接绑定的动作。
 * 复用约定：数据动作取 useWechatFans，状态到文案的映射取 fans/utils/syncText，提示走 sonner 固定 id；
 * 只编排命令与反馈，不自行保存任何同步状态。
 * 关键约束：toast 级别由 describeSyncResult 归一，异常统一用 toErrorText 转中文；加载态透出 hook 的 isSyncing，
 * 由调用方按同一状态禁用按钮，避免两处布尔值不同步。
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import { toErrorText } from '@shared/utils/error'
import type { WechatFansState } from './useWechatFans'
import { describeSyncResult } from '../fans/utils/syncText'

/** 同步 toast 的固定 id：用同一条提示承载开始与结果 */
const SYNC_TOAST_ID = 'wechat-fans-sync'

/** 同步命令的对外契约 */
export interface UseWechatFansSyncResult {
    sync: () => Promise<void>
    isSyncing: boolean
}

/** 返回可绑定的同步动作与加载态 */
export function useWechatFansSync(state: WechatFansState): UseWechatFansSyncResult {
    const sync = useCallback(async (): Promise<void> => {
        toast.loading('正在同步公众号用户…', { id: SYNC_TOAST_ID })
        try {
            const { task } = await state.sync()
            const result = describeSyncResult(task)
            toast[result.level](result.message, { id: SYNC_TOAST_ID })
        } catch (cause) {
            toast.error(toErrorText(cause), { id: SYNC_TOAST_ID })
        }
    }, [state])

    return { sync, isSyncing: state.isSyncing }
}
