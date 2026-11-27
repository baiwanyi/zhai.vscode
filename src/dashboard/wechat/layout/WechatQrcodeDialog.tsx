/**
 * 关注二维码弹窗：按账号从宿主取关注二维码，以内联图片展示供读者扫码关注。
 * 复用约定：请求走 @shared/utils/bridge 的 wechat/account/qrcode，骨架取 @webview/components/Dialog，
 * 加载与失败态取 blocks/Empty，重试按钮取 components/Button；入参只收账号摘要与关闭回调。
 * 关键约束：Webview 的 CSP 不放行微信图片域名，只渲染宿主回传的 data URI；
 * 请求超时长于宿主侧的鉴权与图片下载之和，失败保留弹窗让用户重试，不静默关闭。
 */
import { QrCode } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WechatAccountQrcodeResult, WechatAccountSummary } from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { Dialog } from '@webview/components/Dialog'
import type { JSX } from 'react'

/** 请求超时：宿主需先取 token 再创建二维码并下载图片，留足慢网余量 */
const QRCODE_REQUEST_TIMEOUT_MS = 25_000

interface WechatQrcodeDialogProps {
    account: WechatAccountSummary
    onOpenChange: (open: boolean) => void
}

export function WechatQrcodeDialog({ account, onOpenChange }: WechatQrcodeDialogProps): JSX.Element {
    const [dataUrl, setDataUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        let isActive = true
        void request<WechatAccountQrcodeResult>(WECHAT_METHODS.accountQrcode, { id: account.id }, QRCODE_REQUEST_TIMEOUT_MS)
            .then((result) => {
                if (isActive) {
                    setDataUrl(result.dataUrl)
                }
            })
            .catch((cause: unknown) => {
                if (isActive) {
                    setError(cause instanceof Error ? cause.message : '二维码加载失败，请稍后重试')
                }
            })
        return (): void => {
            isActive = false
        }
    }, [account.id, attempt])

    return (
        <Dialog
            open
            title="关注公众号"
            description={`用微信扫一扫关注「${account.name}」`}
            showFooter={false}
            onOpenChange={onOpenChange}
        >
            {error !== null ? (
                <Empty title="二维码加载失败" description={error} icon={QrCode}>
                    <Button
                        variant="outline"
                        onClick={() => {
                            setError(null)
                            setAttempt((previous) => previous + 1)
                        }}
                    >
                        重试
                    </Button>
                </Empty>
            ) : dataUrl === null ? (
                <Empty title="正在获取二维码" icon={QrCode} isLoading />
            ) : (
                <div className="flex flex-col items-center gap-3">
                    <img src={dataUrl} alt={`${account.name}关注二维码`} className="size-56 rounded-lg bg-white p-2" />
                    <p className="text-center text-xs text-muted-foreground">用微信扫一扫，关注公众号</p>
                </div>
            )}
        </Dialog>
    )
}
