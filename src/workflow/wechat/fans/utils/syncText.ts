/**
 * 同步结果文案：把任务状态与计数归一为可展示的提示级别与内容。
 * 复用约定：纯函数，输入 WechatFanSyncTask，输出 { level, message }，不依赖 React 与宿主协议，可在测试里直接断言。
 * 关键约束：success / partial / running 都按成功级提示但文案区分续跑语义；失败级优先展示 errorHint，
 * 计数文案始终由任务字段拼出，不在本模块发起任何副作用。
 */
import type { WechatFanSyncTask } from '@shared/types/wechat'

/** 与 sonner 提示级别一致的窄类型 */
export type SyncToastLevel = 'success' | 'error'

/** 同步结果的提示级别与文案 */
export interface SyncToastResult {
    level: SyncToastLevel
    message: string
}

/** 任务状态 → 提示级别与文案 */
export function describeSyncResult(task: WechatFanSyncTask): SyncToastResult {
    const progress = `已拉取 ${String(task.fetched)} / ${String(task.total)} · 新增 ${String(task.createdCount)} · 更新 ${String(task.updatedCount)}`
    if (task.status === 'success') {
        return { level: 'success', message: `同步完成：${progress}` }
    }
    if (task.status === 'partial') {
        return { level: 'success', message: `本轮同步完成，可继续同步：${progress}` }
    }
    if (task.status === 'running') {
        return { level: 'success', message: `已拉取部分关注者，可继续同步：${progress}` }
    }
    return { level: 'error', message: `同步失败：${task.errorHint ?? progress}` }
}
