/**
 * 连续生成授权确认框：挂起一条已拼装正文，用户确认后由调用方以「本轮直接写入」发出。
 * 复用约定：外壳取 @webview/components/ConfirmDialog，文案固定在本组件内，调用方只传挂起项与两个动作。
 * 关键约束：pending 为 null 即关闭；关闭（遮罩 / Esc / 取消）走 onDismiss，确认走 onConfirm，两条路径互斥；
 * 授权只对本次发送生效，文案需向用户说明这一点。
 */
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import type { PendingAutoApprove } from '../hooks/useAiChatAutoApprove'
import type { JSX } from 'react'

interface AiChatAutoApproveDialogProps {
    /** 待确认的连续生成请求：null 表示不展示 */
    pending: PendingAutoApprove | null
    onConfirm: () => void
    onDismiss: () => void
}

export function AiChatAutoApproveDialog({ pending, onConfirm, onDismiss }: AiChatAutoApproveDialogProps): JSX.Element {
    return (
        <ConfirmDialog
            open={pending !== null}
            title="允许本轮直接写入？"
            description="本轮将允许模型在作品目录（含当前文档）内连续写入，不再逐个确认；授权仅对本次发送生效。"
            confirmLabel="允许并发送"
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onDismiss()
                }
            }}
            onConfirm={onConfirm}
        />
    )
}
