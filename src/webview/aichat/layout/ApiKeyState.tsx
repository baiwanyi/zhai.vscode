/**
 * AI 对话无密钥引导态（AC-6）：以空态卡片替代异常栈，直接给出 DeepSeek 密钥配置入口。
 * 复用 @/components/ui 的 empty/button 组件；密钥配置动作由宿主命令完成，本组件只透传回调。
 */
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { JSX } from 'react'

/** 无 Key 引导（AC-6）：以空态卡片替代异常栈，直接给出配置入口 */
export function ApiKeyState({ onSetup }: { onSetup: () => void }): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <KeyRound className="size-5" />
                </EmptyMedia>
                <EmptyTitle>先配置 DeepSeek API Key</EmptyTitle>
                <EmptyDescription>
                    密钥保存在系统密钥库（SecretStorage），不会写入设置文件与仓库，日志中仅显示末 4 位。
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button size="sm" onClick={onSetup}>
                    <KeyRound data-icon="inline-start" />
                    设置 API Key
                </Button>
            </EmptyContent>
        </Empty>
    )
}
