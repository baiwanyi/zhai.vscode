/**
 * 个人主页导航的 Provider：把页面层的「打开主页」回调注入整棵微博树。
 * 复用约定：context 与读取 Hook 在 weiboUserPageContext，本文件只提供组件；
 * 正文 @账号、标题行 @uid 与账号菜单因此共用同一个入口。
 * 关键约束：值随 openUser 引用记忆，页面每次渲染都传同一个回调时这里不会重建子树。
 */
import { useMemo } from 'react'
import { WeiboUserPageContext } from './weiboUserPageContext'
import type { WeiboUserTarget } from '../utils/weiboLinks'
import type { WeiboUserPageNav } from './weiboUserPageContext'
import type { JSX, ReactNode } from 'react'

interface WeiboUserPageProviderProps {
    openUser: (target: WeiboUserTarget) => void
    children: ReactNode
}

export function WeiboUserPageProvider({ openUser, children }: WeiboUserPageProviderProps): JSX.Element {
    const value = useMemo<WeiboUserPageNav>(() => ({ openUser }), [openUser])
    return <WeiboUserPageContext value={value}>{children}</WeiboUserPageContext>
}
