/**
 * 流内是/否确认卡片：承载「允许 / 拒绝」二选一的确认（当前为写入类工具），不再让用户填任何内容。
 * 复用 @components/ui 的 Card 槽位与 @webview/components/Button，版式对齐系统级权限确认：
 * 居中标题与说明、底部等宽双按钮（左拒绝描边、右允许高亮）。
 * 风险说明由宿主经 effect 下发，本组件只渲染，不按工具名推断操作后果。
 * 关键约束：拒绝是安全默认 —— 关闭、超时、切会话一律按拒绝结算，本组件也不把「允许」设为默认焦点；
 * 标题只报动作，说明只给文件名、完整路径放进悬浮提示，路径合法性仍由宿主重新校验，前端不做白名单判断。
 */
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@components/ui/card'
import type { AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { describeTool, toFileName } from '../utils'

interface AiChatConfirmCardProps {
    /** 待确认事项：kind 必为 tool */
    request: AiPermissionRequest
    /** 提交决定：允许时带回原目标路径，拒绝时只传 allowed=false */
    onSubmit: (decision: AiPermissionDecision) => void
}

export function AiChatConfirmCard({ request, onSubmit }: AiChatConfirmCardProps): JSX.Element {
    const action = describeTool(request.toolName)
    return (
        <Card size="sm" className="mx-0.5 my-6" role="group" aria-label={`${action}确认`}>
            <CardHeader className="text-center">
                <CardTitle className="text-lg">允许{action}？</CardTitle>
                <CardDescription>
                    目标：
                    <span title={request.detail}>{toFileName(request.detail)}</span>
                    <br />
                    {request.effect}
                </CardDescription>
            </CardHeader>
            {/* 两个出口必须等宽：权重相同才不会让「允许」看起来更像默认动作 */}
            <CardFooter className="gap-2 *:flex-1">
                <Button variant="outline" onClick={() => onSubmit({ allowed: false })}>
                    拒绝
                </Button>
                <Button onClick={() => onSubmit({ allowed: true, path: request.editablePath ?? '' })}>允许</Button>
            </CardFooter>
        </Card>
    )
}
