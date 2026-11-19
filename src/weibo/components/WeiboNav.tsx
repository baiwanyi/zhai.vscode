/**
 * 微博顶部固定菜单：左侧四个信息流入口，右侧个人主页与设置。
 * 复用约定：按钮取 @webview/components/Button，激活态用 secondary 变体与 aria-current 标记；
 * 视图枚举在本文件导出，页面据此切换内容，菜单自身不持有任何状态。
 * 关键约束：个人主页是外链动作而非视图，需要账号 uid，故走独立回调并由页面判定是否可用；
 * 菜单随 AppHeader 固定在顶部，不参与内容区滚动。
 */
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 页面视图：四个信息流入口 + 设置；个人主页是外链动作，不进入视图枚举 */
export type WeiboView = 'home' | 'timeline' | 'hot' | 'groups' | 'settings'

interface NavItem {
    view: WeiboView
    label: string
}

/** 左侧信息流入口：顺序即页面默认阅读顺序 */
const PRIMARY_ITEMS: readonly NavItem[] = [
    { view: 'home', label: '首页' },
    { view: 'timeline', label: '时间线' },
    { view: 'hot', label: '热门' },
    { view: 'groups', label: '分组' },
]

interface WeiboNavProps {
    active: WeiboView
    onSelect: (view: WeiboView) => void
    onOpenProfile: () => void
    /** 个人主页需要账号 uid：未取到分组信息时禁用，避免点了没反应 */
    isProfileDisabled: boolean
}

export function WeiboNav({ active, onSelect, onOpenProfile, isProfileDisabled }: WeiboNavProps): JSX.Element {
    return (
        <nav className="flex w-full flex-wrap items-center gap-1" aria-label="微博导航">
            {PRIMARY_ITEMS.map((item) => (
                <Button
                    key={item.view}
                    size="sm"
                    variant={active === item.view ? 'secondary' : 'ghost'}
                    aria-current={active === item.view ? 'page' : undefined}
                    onClick={() => {
                        onSelect(item.view)
                    }}
                >
                    {item.label}
                </Button>
            ))}
            <div className="ml-auto flex items-center gap-1">
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={isProfileDisabled}
                    onClick={onOpenProfile}
                    tooltip={isProfileDisabled ? '读取到账号后才能打开个人主页' : '在浏览器打开你的微博主页'}
                >
                    个人主页
                </Button>
                <Button
                    size="sm"
                    variant={active === 'settings' ? 'secondary' : 'ghost'}
                    aria-current={active === 'settings' ? 'page' : undefined}
                    onClick={() => {
                        onSelect('settings')
                    }}
                >
                    设置
                </Button>
            </div>
        </nav>
    )
}
