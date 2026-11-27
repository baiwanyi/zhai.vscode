/**
 * 用户状态图标：把拉黑、关注、取关三态映射为互斥的背景色与图标。
 * 复用约定：状态判定复用 fans/utils/fanStatus，图标取 lucide-react，样式用 Tailwind 主题 token。
 * 关键约束：拉黑优先于关注状态，避免双重高亮；状态文字由图标与颜色表达，不额外挂 title。
 */
import { Ban, UserRoundCheck, UserRoundX } from 'lucide-react'
import { ItemMedia } from '@components/ui/item'
import type { WechatFanSummary } from '@shared/types/wechat'
import type { JSX } from 'react'
import { readFanStatus } from '../utils/fanStatus'

interface FanStatusIconProps {
    fan: WechatFanSummary
}

export function FanStatusIcon({ fan }: FanStatusIconProps): JSX.Element {
    const status = readFanStatus(fan)
    return (
        <ItemMedia
            variant="icon"
            className={`size-12 rounded-md text-white ${
                status === 'blocked' ? 'bg-destructive' : status === 'subscribed' ? 'bg-primary' : 'bg-muted'
            }`}
        >
            {status === 'blocked' ? (
                <Ban className="size-4" />
            ) : status === 'unsubscribed' ? (
                <UserRoundX className="size-4" />
            ) : (
                <UserRoundCheck className="size-4" />
            )}
        </ItemMedia>
    )
}
