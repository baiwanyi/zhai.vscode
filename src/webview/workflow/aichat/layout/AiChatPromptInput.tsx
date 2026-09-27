/**
 * AI 对话输入区：InputGroup 输入框（Enter 发送 / Shift+Enter 换行）与按钮组——
 * 生成中显示停止按钮，否则显示发送按钮（输入为空或未配置密钥时禁用），左侧为插件设置入口。
 * 交互经回调上抛，本组件不持有会话状态。
 */
import { ArrowUp, Settings, Square } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'

interface AiChatPromptInputProps {
    input: string
    setInput: (input: string) => void
    hasApiKey: boolean
    isGenerating: boolean
    phase: Phase
    onSend: () => void
    onStop: () => void
    onOpenSettings: () => void
}

export function AiChatPromptInput({
    input,
    setInput,
    hasApiKey,
    isGenerating,
    phase,
    onSend,
    onStop,
    onOpenSettings,
}: AiChatPromptInputProps): JSX.Element {
    return (
        <InputGroup>
            <InputGroupTextarea
                value={input}
                className="max-h-40"
                placeholder={hasApiKey ? '输入消息…' : '请先设置 DeepSeek API Key'}
                disabled={!hasApiKey || isGenerating}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        onSend()
                    }
                }}
            />
            <InputGroupAddon align="block-end" className="justify-between">
                <InputGroupButton
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full"
                    title="插件设置"
                    onClick={onOpenSettings}
                >
                    <Settings />
                </InputGroupButton>
                {isGenerating ? (
                    <InputGroupButton
                        size="icon-sm"
                        variant="outline"
                        className="rounded-full"
                        title="停止生成"
                        onClick={onStop}
                    >
                        <Square />
                    </InputGroupButton>
                ) : (
                    <InputGroupButton
                        size="icon-sm"
                        variant="default"
                        className="rounded-full"
                        title="发送"
                        disabled={!hasApiKey || phase !== 'idle' || input.trim().length === 0}
                        onClick={onSend}
                    >
                        <ArrowUp />
                    </InputGroupButton>
                )}
            </InputGroupAddon>
        </InputGroup>
    )
}
