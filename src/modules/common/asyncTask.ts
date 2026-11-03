/**
 * 异步任务失败兜底：把「即发即忘」的 Promise 失败收进日志，避免变成未处理拒绝。
 * 复用约定：统一走 common/logger，标签由调用方给出（形如「激活自检失败」），保证日志可检索；
 * 用工厂形式接收任务，任务启动时的同步抛错与异步失败走同一条记录路径。
 * 关键约束：只记录、不重抛——调用点都在激活流程或事件回调里，失败无处可接；
 * 需要让调用方感知失败的场景不要用本函数。
 */
import { logger } from './logger'

/** 执行并忽略结果：启动期同步抛错与异步失败都按标签记一条错误日志 */
export function runWithLoggedFailure(start: () => Promise<unknown>, label: string): void {
    const handle = (error: unknown): void => logger.error(label, error)
    let task: Promise<unknown>
    try {
        task = start()
    } catch (error) {
        handle(error)
        return
    }
    void task.catch(handle)
}
