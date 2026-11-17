/**
 * AI 对话草稿：持有已挂规则与未发送正文，负责防抖写入宿主草稿、按会话快照回填、按历史消息回填。
 * 复用约定：快照与消息类型取 @shared/types/aiChat，规则类型取 @shared/types/promptLibrary，
 * 持久化走 @shared/utils/bridge 的 ai/draft 协议。
 * 关键约束：ruleNames 的 ref 与 state 必须同一出口同步写——快照回填先判 ref 再判 state，
 * 否则一次渲染延迟会让用户之后主动摘除的规则被重新恢复；同一会话的草稿只套用一次；
 * 历史消息只回填规则与正文，引用不恢复（历史引用可能已失效）；正文为空串也要回填，用于清掉旧输入。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiMessage, AiSessionSnapshot } from '@shared/types/aiChat'
import type { PromptRule } from '@shared/types/promptLibrary'
import { request } from '@shared/utils/bridge'

/** 草稿落宿主的防抖时长：连续输入只在停顿后写一次 */
const DRAFT_DEBOUNCE_MS = 300

/** 草稿 hook 的对外依赖：会话 id 决定草稿归属，正文与写入函数由会话 hook 持有 */
export interface UseAiChatDraftOptions {
    /** 当前会话 id：草稿按会话保存，null 表示会话尚未就绪，不写入 */
    conversationId: string | null
    /** 当前输入正文：仅用于防抖持久化，不由此 hook 持有 */
    input: string
    setInput: (input: string) => void
}

/** 草稿对外暴露的状态与操作 */
export interface AiChatDraftState {
    /** 已挂规则名：按挂载顺序，发送时随请求下发 */
    ruleNames: readonly string[]
    /** 规则点击：已挂则摘除，未挂则追加到末尾 */
    toggleRule: (rule: PromptRule) => void
    /** 规则改名：把已挂标识换到新名称上 */
    renameRule: (previousName: string, rule: PromptRule) => void
    /** 规则被删除：摘掉同名挂载 */
    removeRule: (ruleName: string) => void
    /** 会话快照回填：只取草稿里的规则，正文由会话 hook 自行恢复 */
    applySnapshot: (snapshot: AiSessionSnapshot) => void
    /** 历史消息回填：规则与正文进输入区，引用不回填 */
    restoreFromMessage: (message: AiMessage) => void
}

export function useAiChatDraft({ conversationId, input, setInput }: UseAiChatDraftOptions): AiChatDraftState {
    const [ruleNames, setRuleNames] = useState<readonly string[]>([])
    /** 已套用草稿的会话 id：避免重复套用把用户之后主动摘除的规则重新恢复 */
    const restoredDraftRef = useRef<string | null>(null)
    /** 规则挂载的最新值：与 state 同步写，快照套用时不读上一帧 */
    const ruleNamesRef = useRef<readonly string[]>([])

    /** 规则变更的唯一出口：ref 与 state 同步写，避免快照套用读到上一帧的值 */
    const commitRules = useCallback((next: readonly string[]): void => {
        ruleNamesRef.current = next
        setRuleNames(next)
    }, [])

    const toggleRule = useCallback(
        (rule: PromptRule): void => {
            const current = ruleNamesRef.current
            commitRules(
                current.includes(rule.name) ? current.filter((name) => name !== rule.name) : [...current, rule.name],
            )
        },
        [commitRules],
    )

    const renameRule = useCallback(
        (previousName: string, rule: PromptRule): void => {
            commitRules(ruleNamesRef.current.map((name) => (name === previousName ? rule.name : name)))
        },
        [commitRules],
    )

    const removeRule = useCallback(
        (ruleName: string): void => {
            commitRules(ruleNamesRef.current.filter((name) => name !== ruleName))
        },
        [commitRules],
    )

    /** 套用草稿中的规则：同一会话只处理一次，本地已有挂载时保留本地 */
    const applySnapshot = useCallback(
        (snapshot: AiSessionSnapshot): void => {
            const id = snapshot.conversation.id
            if (restoredDraftRef.current === id) {
                return
            }
            restoredDraftRef.current = id
            const draftRules = snapshot.draft.ruleNames
            if (ruleNamesRef.current.length === 0 && draftRules !== undefined && draftRules.length > 0) {
                commitRules(draftRules)
            }
        },
        [commitRules],
    )

    const restoreFromMessage = useCallback(
        (message: AiMessage): void => {
            commitRules(message.ruleNames)
            setInput(message.content)
        },
        [commitRules, setInput],
    )

    // 未发送正文与规则防抖写入宿主草稿：侧边栏切换导致 webview 重建后由会话快照带回
    useEffect(() => {
        if (conversationId === null) {
            return
        }
        const timer = setTimeout(() => {
            void request('ai/draft', { conversationId, input, ruleNames })
        }, DRAFT_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [conversationId, input, ruleNames])

    return useMemo(
        () => ({ ruleNames, toggleRule, renameRule, removeRule, applySnapshot, restoreFromMessage }),
        [applySnapshot, removeRule, renameRule, restoreFromMessage, ruleNames, toggleRule],
    )
}
