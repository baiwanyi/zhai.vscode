/**
 * 规则目录 Provider：把页面级的规则名集合包进消息流，供气泡判断规则是否已被删除。
 * 复用约定：上下文实例与读取 hook 在 ruleCatalog，本文件只导出组件，保持 fast refresh 可用。
 * 关键约束：值为 null 时表示目录尚未读到，气泡不得据此判定删除；本层不请求数据，只做透传。
 */
import { AiChatRuleCatalogContext } from './ruleCatalog'
import type { JSX, ReactNode } from 'react'

interface AiChatRuleCatalogProviderProps {
    names: ReadonlySet<string> | null
    children: ReactNode
}

export function AiChatRuleCatalogProvider({ names, children }: AiChatRuleCatalogProviderProps): JSX.Element {
    return <AiChatRuleCatalogContext value={names}>{children}</AiChatRuleCatalogContext>
}
