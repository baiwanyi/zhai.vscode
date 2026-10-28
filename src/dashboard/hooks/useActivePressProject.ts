/**
 * 活跃作品同步：挂载时拉一次快照，之后跟随宿主 press 通道广播，供仪表盘同步到当前文档所属作品。
 * 复用 @shared/utils/bridge 的 request 与状态订阅，与 note/active 同形；路径归属由宿主按索引库校验。
 * 关键约束：非 press 通道或形态非法的载荷一律忽略；值未变化时 setState 相同值不会触发重渲染，
 * 因而页面只在「所属作品真的换了」时收到新值，用户点返回不会被无意义广播打回。
 */
import { useEffect, useState } from 'react'
import type { PressActiveState } from '@shared/types/press'
import { isPressActiveState } from '@shared/types/press'
import { onState, request } from '@shared/utils/bridge'

/** 读取当前活动文档所属的作品目录：未命中作品文档时为 null */
export function useActivePressProject(): string | null {
    const [activeProjectDirPath, setActiveProjectDirPath] = useState<string | null>(null)

    useEffect(() => {
        let isDisposed = false
        const loadActiveProject = async (): Promise<void> => {
            try {
                const snapshot = await request<PressActiveState>('press/active')
                if (!isDisposed && isPressActiveState(snapshot)) {
                    setActiveProjectDirPath(snapshot.activeProjectDirPath)
                }
            } catch {
                // 面板刚挂载时宿主可能尚未就绪，失败即保留空态，等广播位再回填
            }
        }
        void loadActiveProject()
        const unsubscribe = onState((message) => {
            if (message.channel !== 'press' || !isPressActiveState(message.payload)) {
                return
            }
            setActiveProjectDirPath(message.payload.activeProjectDirPath)
        })
        return (): void => {
            isDisposed = true
            unsubscribe()
        }
    }, [])

    return activeProjectDirPath
}
