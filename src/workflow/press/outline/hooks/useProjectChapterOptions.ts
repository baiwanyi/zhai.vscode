/**
 * 提取选项来源：读仪表盘的作品详情，把卷分组章节摊平成范围选择用的选项。
 * 复用约定：请求走 @shared/utils/bridge 的 press/detail，选项结构由 utils.createProjectChapterOptions 给出。
 * 关键约束：只读作品列表而非大纲草稿——素材草案由章节清单产出，按大纲章选择会与素材错位；
 * 面板挂在对话框里，每次打开重新挂载即重新读取，刚在仪表盘新增的章马上可选；
 * 读取失败只回 failed 状态，由面板给出提示，不抛错打断页面。
 */
import { useEffect, useState } from 'react'
import type { PressProjectDetail } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import type { ProjectChapterOption } from '../../utils'
import { createProjectChapterOptions } from '../../utils'

/** 读取状态：读取中 / 已就绪 / 读取失败 */
export type ProjectChaptersStatus = 'loading' | 'ready' | 'failed'

export interface ProjectChaptersState {
    status: ProjectChaptersStatus
    options: ProjectChapterOption[]
}

/** 初始状态按读取中处理，避免先闪一帧「作品没有章节」 */
const LOADING_STATE: ProjectChaptersState = { status: 'loading', options: [] }

export function useProjectChapterOptions(dirPath: string): ProjectChaptersState {
    const [state, setState] = useState<ProjectChaptersState>(LOADING_STATE)

    useEffect(() => {
        let isCancelled = false
        setState(LOADING_STATE)
        const load = async (): Promise<void> => {
            try {
                const detail = await request<PressProjectDetail>('press/detail', { dirPath })
                if (isCancelled) {
                    return
                }
                setState({ status: 'ready', options: createProjectChapterOptions(detail.volumes) })
            } catch {
                if (isCancelled) {
                    return
                }
                setState({ status: 'failed', options: [] })
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [dirPath])

    return state
}
