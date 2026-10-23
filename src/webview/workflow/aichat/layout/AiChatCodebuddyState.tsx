/**
 * CodeBuddy 通道空态：未确认登录时给登录引导，已登录时给「可直接开始」的说明。
 * 复用 @components/ui 的 empty/button 组件；登录动作由宿主命令完成，本组件只透传回调。
 * 关键约束：不阻断输入区——两种状态下用户都可直接在下方输入框开始对话；
 * 是否已登录由宿主下发（本插件内登录成功，或生成请求已走通一次），前端不自行推断；
 * 站点由宿主经运行时信息下发，切换站点需重新登录，故文案必须点名站点。
 */
import { LogIn, Sparkles } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { JSX } from 'react'

interface AiChatCodebuddyStateProps {
    /** 当前站点展示名，未下发时退化为通道名 */
    site?: string
    /** 宿主确认的登录态：为真时不再展示登录按钮 */
    loggedIn: boolean
    /** 已登录账号名；确认可用但未拿到账号名时为 null */
    userName: string | null
    onLogin: () => void
}

/** CodeBuddy 通道空态：按登录态分流引导与说明 */
export function AiChatCodebuddyState({ site, loggedIn, userName, onLogin }: AiChatCodebuddyStateProps): JSX.Element {
    const siteLabel = site ?? 'CodeBuddy'
    if (loggedIn) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                        <Sparkles className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>
                        已登录 CodeBuddy（{userName === null ? siteLabel : `${siteLabel} / ${userName}`}）
                    </EmptyTitle>
                    <EmptyDescription>
                        对话、取名与人物外貌生成走 CodeBuddy
                        额度，直接在下方输入即可开始；切换站点（zhai.ai.codebuddySite）后需重新登录。
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <LogIn className="size-5" />
                </EmptyMedia>
                <EmptyTitle>当前使用 CodeBuddy（{siteLabel}）</EmptyTitle>
                <EmptyDescription>
                    对话、取名与人物外貌生成走 CodeBuddy 额度。首次使用需完成一次浏览器登录，凭据按站点保存在本机，
                    切换站点（zhai.ai.codebuddySite）后需重新登录。
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button onClick={onLogin}>
                    <LogIn data-icon="inline-start" />
                    登录 {siteLabel}
                </Button>
            </EmptyContent>
        </Empty>
    )
}
