/**
 * AI 对话底部提示行：模式提示与常态快捷键文案的二选一展示。
 * 复用约定：快捷键键名复用 ui/kbd（KbdGroup 聚合键名与动作），纯展示组件不承载交互。
 * 关键约束：错误与操作结果已统一由 sonner 弹出，此处只留常驻的弱化提示。
 */
import { Kbd, KbdGroup } from '@components/ui/kbd'
import type { JSX } from 'react'

interface AiChatStatusHintProps {
    /** 模式相关提示：如写作模式缺少可改写目标 */
    hint: string | null
    isGenerating: boolean
}

/** 常态快捷键提示：键名与动作分开渲染，便于用 Kbd 表达按键 */
const SHORTCUT_HINTS: { keys: string[]; action: string }[] = [
    { keys: ['Enter'], action: '发送' },
    { keys: ['Shift', 'Enter'], action: '换行' },
    { keys: ['Ctrl', 'Shift', 'L'], action: '聚焦' },
]

export function AiChatStatusHint({ hint, isGenerating }: AiChatStatusHintProps): JSX.Element {
    return (
        <p className="flex flex-wrap items-center justify-center gap-2 text-center text-muted-foreground">
            {hint ??
                (isGenerating ? (
                    '正在生成，可随时停止'
                ) : (
                    SHORTCUT_HINTS.map((shortcut) => (
                        <KbdGroup key={shortcut.action}>
                            {shortcut.keys.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                            ))}
                            <span>{shortcut.action}</span>
                        </KbdGroup>
                    ))
                ))}
        </p>
    )
}
