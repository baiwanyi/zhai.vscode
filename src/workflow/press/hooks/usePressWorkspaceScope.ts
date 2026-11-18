/**
 * 作品工作区作用域：把文档读取（usePressWorkspace）与结构性变更（usePressMutations）装配成页面唯一的数据入口，
 * 与公众号页的 useWechatAccountScope 对齐——页面只做分区分派，不再自己拼装两个 hook。
 * 关键约束：status 沿用三态（loading / empty / ready），empty 表示未打开作品而非读取失败；
 * mutations 的读取一律走 getWorkspace 取最新草稿；reload 只用于重试，会先回到 loading 再重读。
 */
import type { PressProjectSummary } from '@shared/types/press'
import { usePressMutations } from './usePressMutations'
import { usePressWorkspace } from './usePressWorkspace'
import type { OutlineWorkspace } from '../types'
import type { PressMutations } from './usePressMutations'
import type { WorkspaceStatus } from './usePressWorkspace'

export interface PressWorkspaceScope {
    /** 读取状态：loading 读取中、empty 未打开作品、ready 已就绪 */
    status: WorkspaceStatus
    workspace: OutlineWorkspace | null
    /** 作品清单：未打开作品时初始页据此给出可选入口 */
    projects: PressProjectSummary[]
    /** 已载入作品的目录：角色卡、媒体与快照按它定位，未载入为 null */
    dirPath: string | null
    /** 全部结构性变更：分派给各分区页面，页面不直接写草稿 */
    mutations: PressMutations
    /** 重读当前作品：读取失败或空态重试时调用 */
    reload: () => void
}

export function usePressWorkspaceScope(projectDir: string | null): PressWorkspaceScope {
    const workspaceState = usePressWorkspace(projectDir)
    const mutations = usePressMutations({
        getWorkspace: workspaceState.getWorkspace,
        updateWorkspace: workspaceState.updateWorkspace,
        flush: workspaceState.flush,
        scheduleFlush: workspaceState.scheduleFlush,
    })

    return {
        status: workspaceState.status,
        workspace: workspaceState.workspace,
        projects: workspaceState.projects,
        dirPath: workspaceState.projectDir,
        mutations,
        reload: workspaceState.reload,
    }
}
