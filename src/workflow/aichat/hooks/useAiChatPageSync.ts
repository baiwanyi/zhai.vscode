/**
 * AI 对话页的宿主同步：首屏拉起会话 / 运行时 / 写入状态，订阅宿主 state 广播按 kind 刷新，
 * 生成结束回到 idle 时兜底刷新用量与写回状态。
 * 复用约定：加载函数与会话快照回调全部由调用方注入，广播载荷的收窄在本文件内完成，
 * 快照经 onSnapshot 上抛给草稿恢复，本 hook 不持有任何业务状态。
 * 关键约束：首屏只跑一次——注入函数的引用必须稳定，否则每次渲染都会重拉会话；
 * 阶段回退刷新只认「非 idle → idle」，首次挂载不重复请求；广播里未知 kind 一律忽略。
 */
import { useEffect, useRef } from 'react'
import type { AiSessionSnapshot } from '@shared/types/aiChat'
import { onState } from '@shared/utils/bridge'
import type { Phase } from '../utils'

/** 宿主 state 广播的可识别类型：只有这三类需要刷新前端数据 */
type AiStateKind = 'runtime' | 'context' | 'writeTarget'

/** 页面同步 hook 的对外依赖：加载函数与会话快照回调需为稳定引用 */
export interface UseAiChatPageSyncOptions {
    phase: Phase
    loadSession: () => Promise<AiSessionSnapshot | null>
    loadRuntime: () => Promise<void>
    loadContexts: () => Promise<void>
    loadWriteState: () => Promise<void>
    /** 会话快照就绪回调：用于恢复草稿中的命令 */
    onSnapshot: (snapshot: AiSessionSnapshot) => void
}

export function useAiChatPageSync({
    phase,
    loadSession,
    loadRuntime,
    loadContexts,
    loadWriteState,
    onSnapshot,
}: UseAiChatPageSyncOptions): void {
    /** 阶段回退到 idle 时刷新用量与写回状态，避免首次挂载重复请求 */
    const previousPhaseRef = useRef<Phase>('idle')

    // 会话就绪后恢复草稿中的命令并读取写入状态，保证写入目标与当前活跃会话一致
    useEffect(() => {
        void loadSession().then((snapshot) => {
            if (snapshot !== null) {
                onSnapshot(snapshot)
            }
            void loadWriteState()
        })
        void loadRuntime()
    }, [loadRuntime, loadSession, loadWriteState, onSnapshot])

    // 密钥增删、上下文与写回状态由宿主广播，按 kind 刷新对应数据
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'ai') {
                return
            }
            const kind = readAiStateKind(message.payload)
            if (kind === 'runtime') {
                void loadRuntime()
            }
            if (kind === 'context') {
                void loadContexts()
            }
            if (kind === 'writeTarget') {
                void loadWriteState()
            }
        })
    }, [loadContexts, loadRuntime, loadWriteState])

    // 生成结束后刷新当日用量与写入状态（宿主也会广播，前端兜底保证圆环及时更新）
    useEffect(() => {
        if (previousPhaseRef.current !== 'idle' && phase === 'idle') {
            void loadRuntime()
            void loadWriteState()
        }
        previousPhaseRef.current = phase
    }, [loadRuntime, loadWriteState, phase])
}

/** 收窄宿主 state 广播的载荷：只信任三种已声明的 kind，其余原样忽略 */
function readAiStateKind(payload: unknown): AiStateKind | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const kind = (payload as { kind?: unknown }).kind
    return kind === 'runtime' || kind === 'context' || kind === 'writeTarget' ? kind : null
}
