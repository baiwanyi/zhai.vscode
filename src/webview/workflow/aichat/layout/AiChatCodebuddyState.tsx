/**
 * CodeBuddy 通道引导态：说明凭据由 CodeBuddy 自行维护，未登录时给出登录入口。
 * 复用 @components/ui 的 empty/button 组件；登录动作由宿主命令完成，本组件只透传回调。
 * 关键约束：不阻断输入区——已登录用户可直接在下方输入框开始对话，本卡片仅承担引导。
 */
import { LogIn } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { JSX } from 'react'

/** CodeBuddy 通道引导：首次使用需完成一次浏览器登录 */
export function AiChatCodebuddyState({ onLogin }: { onLogin: () => void }): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <LogIn className="size-5" />
                </EmptyMedia>
                <EmptyTitle>当前使用 CodeBuddy 通道</EmptyTitle>
                <EmptyDescription>
                    对话、取名与人物外貌生成走 CodeBuddy 额度。首次使用需完成一次浏览器登录，凭据由 CodeBuddy
                    保存在本机，不写入插件设置。
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button size="sm" onClick={onLogin}>
                    <LogIn data-icon="inline-start" />
                    登录 CodeBuddy
                </Button>
            </EmptyContent>
        </Empty>
    )
}
