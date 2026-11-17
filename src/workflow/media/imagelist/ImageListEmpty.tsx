/**
 * 图片列表状态位：按加载、错误、库空与筛选无结果的优先级渲染统一空态。
 * 复用约定：结构取 @webview/components/StateEmpty，加载态与空态互斥由 StateEmpty 自身保证；
 * 文案、图标与底部操作区由调用方经 states 注入，本组件不写任何业务措辞。
 * 关键约束：加载态优先于空态，避免先闪一下「还没有图片」；本组件不产生包裹节点，
 * 空态仍是 AppContent 的直接弹性子元素，居中布局不被破坏。
 */
import { StateEmpty } from '@webview/components/StateEmpty'
import type { ImageListStates } from './imageListModel'
import type { JSX } from 'react'

/** 空态占满滚动区并纵向居中：加载态与空态互切时位置不跳动 */
const FILL_SLOT_CLASS = 'flex-1 justify-center'

interface ImageListEmptyProps {
    phase: 'loading' | 'error' | 'empty' | 'no-result'
    states: ImageListStates
    errorText?: string | null
}

export function ImageListEmpty({ phase, states, errorText }: ImageListEmptyProps): JSX.Element {
    const className = states.emptyClassName ?? FILL_SLOT_CLASS

    if (phase === 'loading') {
        const label = states.loadingLabel ?? '正在读取…'
        return <StateEmpty title={label} isLoading className={className} />
    }

    const view =
        phase === 'error'
            ? (states.error ?? { title: '没能取到图片', description: errorText ?? undefined })
            : phase === 'no-result'
              ? (states.noResult ?? states.empty)
              : states.empty

    return (
        <StateEmpty title={view.title} description={view.description} icon={view.icon} className={className}>
            {view.action}
        </StateEmpty>
    )
}
