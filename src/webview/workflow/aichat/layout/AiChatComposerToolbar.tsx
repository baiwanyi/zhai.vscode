/**
 * AI 对话输入区顶部工具行：左侧命令菜单、右侧参考菜单，严格保持两个按钮。
 * 复用 @/components/ui 的 InputGroupAddon 包裹两个独立菜单组件，本层只做布局与禁用态分发。
 * 关键约束：工具行内不放入设置、会话等其它入口，避免与模板的两个按钮约定冲突。
 */
import { InputGroupAddon } from '@/components/ui/input-group'
import { AiChatCommandMenu } from './AiChatCommandMenu'
import { AiChatReferenceMenu } from './AiChatReferenceMenu'
import type { AiCommand, AiReferenceSource } from '../constants'
import type { JSX } from 'react'

interface AiChatComposerToolbarProps {
    disabled: boolean
    onCommand: (command: AiCommand) => void
    onReference: (source: AiReferenceSource) => void
}

export function AiChatComposerToolbar({
    disabled,
    onCommand,
    onReference,
}: AiChatComposerToolbarProps): JSX.Element {
    return (
        <InputGroupAddon align="block-start" className="justify-start gap-1 px-2 pt-2 pb-0">
            <AiChatCommandMenu disabled={disabled} onSelect={onCommand} />
            <AiChatReferenceMenu disabled={disabled} onSelect={onReference} />
        </InputGroupAddon>
    )
}
