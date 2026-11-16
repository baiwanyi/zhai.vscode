/**
 * AI 对话输入卡片顶部工具行：左侧「添加上下文」、右侧「参考资料」，严格保持两个按钮。
 * 采用普通行容器承载两个独立入口；上下文入口自带触发器与选择器，本层只做布局与 props 透传。
 * 关键约束：工具行内不放入设置、会话等其它入口，避免与模板的两个按钮约定冲突；
 * 本层不持有浮层开关与规则编排——它们都在 AiChatContextMenu 内，避免工具行承担业务状态；
 * 留白由外层 AppComposerHeader 的 p-1 提供，本层不再自带 padding，否则会叠加成双重缩进。
 */
import type { PromptRule } from '@shared/types/promptLibrary'
import { AiChatContextMenu } from './AiChatContextMenu'
import { AiChatReferenceMenu } from './AiChatReferenceMenu'
import type { AiReferenceAction } from '../constants'
import type { JSX } from 'react'

interface AiChatComposerToolbarProps {
    disabled: boolean
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：复用参考资料菜单入口，不额外占用工具行按钮 */
    onMention: () => void
    /** 上下文添加成功后刷新清单 */
    onContextAdded: () => void
    /** 上下文添加失败的提示出口 */
    onContextError: (error: string) => void
    /** 已挂规则名：上下文入口的规则视图据此回显挂载态 */
    ruleNames: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onRenameRule: (previousName: string, rule: PromptRule) => void
    onRemoveRule: (ruleName: string) => void
}

export function AiChatComposerToolbar({
    disabled,
    onReference,
    onMention,
    onContextAdded,
    onContextError,
    ruleNames,
    onToggleRule,
    onRenameRule,
    onRemoveRule,
}: AiChatComposerToolbarProps): JSX.Element {
    return (
        <div className="flex items-center gap-0.5">
            <AiChatContextMenu
                disabled={disabled}
                onContextAdded={onContextAdded}
                onContextError={onContextError}
                ruleNames={ruleNames}
                onToggleRule={onToggleRule}
                onRenameRule={onRenameRule}
                onRemoveRule={onRemoveRule}
            />
            <AiChatReferenceMenu disabled={disabled} onReference={onReference} onMention={onMention} />
        </div>
    )
}
