/**
 * 规则目录快照：只取规则名集合，供历史消息判断「该规则是否已被删除」。
 * 复用约定：协议走 pressAi/listPromptRules（宿主已把 pressAi/* 转发给写作管理路由），
 * 类型取 @shared/types/promptLibrary，与规则菜单读同一个 prompt/rules 目录。
 * 关键约束：读取失败保持 null —— 未知不能当作已删除，否则会把全部规则徽章误置灰；
 * 规则的新建、改名与删除后由调用方主动 reload，本 hook 不轮询也不监听文件变化。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PromptRuleListResult } from '@shared/types/promptLibrary'
import { request } from '@shared/utils/bridge'

/** 规则目录状态的对外结构 */
export interface AiChatRuleCatalogState {
    /** 现存规则名：null 表示尚未读取成功，调用方不得据此判定删除 */
    names: ReadonlySet<string> | null
    reload: () => Promise<void>
}

export function useAiChatRuleCatalog(): AiChatRuleCatalogState {
    const [names, setNames] = useState<ReadonlySet<string> | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const result = await request<PromptRuleListResult>('pressAi/listPromptRules')
            setNames(new Set(result.rules.map((rule) => rule.name)))
        } catch {
            // 目录读不到时保持上一次快照：错误提示已由规则菜单自己承担，这里静默降级
        }
    }, [])

    // 首屏读一次：用户即使没打开规则菜单，历史徽章也能正确反映删除态
    useEffect(() => {
        void reload()
    }, [reload])

    return useMemo(() => ({ names, reload }), [names, reload])
}
