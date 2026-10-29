/**
 * AI 对话输入卡片顶部工具行：左侧命令菜单、右侧参考菜单，严格保持两个按钮。
 * 采用普通行容器承载两个独立菜单组件，本层只做布局与禁用态分发。
 * 关键约束：工具行内不放入设置、会话等其它入口，避免与模板的两个按钮约定冲突。
 */
import { AiChatCommandMenu } from './AiChatCommandMenu'
import { AiChatReferenceMenu } from './AiChatReferenceMenu'
import type { AiCommand, AiCommandId } from '../constants'
import type { AiReferenceAction } from './AiChatReferenceMenu'
import type { JSX } from 'react'

interface AiChatComposerToolbarProps {
    disabled: boolean
    /** 当前已选命令：供菜单展示勾选标记 */
    activeCommandId: AiCommandId | null
    onCommand: (command: AiCommand) => void
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：复用参考菜单入口，不额外占用工具行按钮 */
    onMention: () => void
}

export function AiChatComposerToolbar({
    disabled,
    activeCommandId,
    onCommand,
    onReference,
    onMention,
}: AiChatComposerToolbarProps): JSX.Element {
    return (
        <div className="flex items-center gap-0.5 p-0.5">
            <AiChatCommandMenu disabled={disabled} activeId={activeCommandId} onSelect={onCommand} />
            <AiChatReferenceMenu disabled={disabled} onSelect={onReference} onMention={onMention} />
        </div>
    )
}
