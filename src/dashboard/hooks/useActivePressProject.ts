/**
 * 活跃作品同步：挂载时拉一次快照，之后跟随宿主 press 通道广播，供仪表盘同步到当前文档所属作品。
 * 复用 @webview/hooks/useHostChannelState 承载快照、订阅与「广播优先于快照」，路径归属由宿主按索引库校验。
 * 关键约束：载荷经 isPressActiveState 收窄，非 press 通道与畸形载荷一律丢弃；
 * 按作品目录做等价判定，同作品的重复广播不触发重渲染，因而页面只在「所属作品真的换了」时收到新值；
 * 同通道多载荷分流或需要就绪态的场景不适用本 Hook，请改用各自的实现。
 */
import { isPressActiveState, type PressActiveState } from '@shared/types/press'
import { useHostChannelState } from '@webview/hooks/useHostChannelState'

/** 初始快照：宿主未响应前按「不在作品文档内」渲染 */
const INITIAL_ACTIVE_PROJECT: PressActiveState = { activeProjectDirPath: null }

/** 等价判定：只比较作品目录——宿主每次广播都是新对象，按字段比较可省掉同作品的无意义重渲染 */
function isSameActiveProject(previous: PressActiveState, next: PressActiveState): boolean {
    return previous.activeProjectDirPath === next.activeProjectDirPath
}

/** 读取当前活动文档所属的作品目录：未命中作品文档时为 null */
export function useActivePressProject(): string | null {
    const state = useHostChannelState<PressActiveState>({
        method: 'press/active',
        channel: 'press',
        isValid: isPressActiveState,
        initial: INITIAL_ACTIVE_PROJECT,
        isEqual: isSameActiveProject,
    })
    return state.activeProjectDirPath
}
