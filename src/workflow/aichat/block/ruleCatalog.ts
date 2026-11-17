/**
 * 规则目录上下文：把「当前规则目录里还剩哪些规则」下发给消息气泡，用于把已删除的规则徽章置灰。
 * 复用约定：值取自页面级 useAiChatRuleCatalog，与规则菜单读同一个目录，但这里只做只读展示；
 * Provider 单独放在 ruleCatalogProvider，避免本文件同时导出组件与 hook 触发 fast refresh 限制。
 * 关键约束：null 表示目录尚未读取成功，此时一律不置灰——不能把「未知」当成「已删除」；
 * 规则的新建、改名与删除仍由上下文菜单里的 useRuleMenu 负责，本上下文不提供任何写操作。
 */
import { createContext, use } from 'react'

/** 规则名集合：null 表示尚未读到目录，不做删除态判定 */
export const AiChatRuleCatalogContext = createContext<ReadonlySet<string> | null>(null)

/** 读取规则名集合：未提供 Provider 时返回 null，历史徽章不会误置灰 */
export function useAvailableRuleNames(): ReadonlySet<string> | null {
    return use(AiChatRuleCatalogContext)
}
