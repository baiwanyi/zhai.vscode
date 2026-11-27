/**
 * 拉黑操作：按黑名单状态互斥显示拉黑或解除拉黑，拉黑需二次确认。
 * 复用约定：确认弹窗用 @webview/components/AlertDialog，挂载判定复用 @webview/hooks/useIsMounted。
 * 关键约束：拉黑写入公众号后台不可撤销，必须确认；解除直接执行；异步回包先判挂载再回写弹窗状态。
 */
import { Ban, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { WechatFanSummary } from '@shared/types/wechat'
import { AlertDialog } from '@webview/components/AlertDialog'
import { Button } from '@webview/components/Button'
import { useIsMounted } from '@webview/hooks/useIsMounted'
import type { JSX } from 'react'

interface FanBlockActionProps {
    fan: WechatFanSummary
    isMutating: boolean
    onBlacklist: (openid: string, action: 'block' | 'unblock') => Promise<boolean>
}

export function FanBlockAction({ fan, isMutating, onBlacklist }: FanBlockActionProps): JSX.Element {
    const [isBlockPending, setIsBlockPending] = useState(false)
    const isMountedRef = useIsMounted()

    return (
        <>
            {fan.isBlocked ? (
                <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`解除拉黑 ${fan.openid}`}
                    tooltip="解除拉黑"
                    disabled={isMutating}
                    onClick={() => void onBlacklist(fan.openid, 'unblock')}
                >
                    <RotateCcw className="size-3.5" />
                </Button>
            ) : (
                <Button
                    size="icon-xs"
                    variant="destructive"
                    aria-label={`拉黑 ${fan.openid}`}
                    tooltip="拉黑该用户"
                    disabled={isMutating}
                    onClick={() => setIsBlockPending(true)}
                >
                    <Ban className="size-3.5" />
                </Button>
            )}
            <AlertDialog
                open={isBlockPending && !fan.isBlocked}
                title="拉黑该用户"
                description="拉黑后该用户将无法接收群发消息；操作会写入公众号后台，请确认后再继续。"
                confirmLabel="确认拉黑"
                isDestructive
                isSubmitting={isMutating}
                onOpenChange={setIsBlockPending}
                onConfirm={async () => {
                    const isBlocked = await onBlacklist(fan.openid, 'block')
                    if (isBlocked && isMountedRef.current) {
                        setIsBlockPending(false)
                    }
                }}
            />
        </>
    )
}
