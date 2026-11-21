/**
 * 右侧热搜栏：宽屏粘性显示，热搜专页不渲染（专页自带整页榜单，避免同一份内容出现两次）。
 * 复用约定：卡片取同目录 WeiboHotRankList，本组件只负责占位与粘性布局。
 * 关键约束：三件事缺一不可——`@3xl:block` 让 hidden 在该档恢复显示、
 * self-start 避免被拉伸到内容高度（拉满后 sticky 没有可粘的行程）、
 * sticky + top 让它在 AppContent 的滚动区里钉住不随列表滚走。
 */
import { WeiboHotRankList } from './WeiboHotRankList'
import type { JSX } from 'react'

export interface HotRankAsideProps {
    isEnabled: boolean
}

export function HotRankAside({ isEnabled }: HotRankAsideProps): JSX.Element {
    return (
        <aside className="hidden w-80 shrink-0 @3xl:sticky @3xl:top-1 @3xl:block @3xl:self-start">
            <WeiboHotRankList isEnabled={isEnabled} />
        </aside>
    )
}
