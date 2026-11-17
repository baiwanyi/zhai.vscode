/**
 * 在线图库页头统计胶囊：已下载张数与本小时剩余配额，悬停给精确口径。
 * 复用约定：胶囊取 @webview/components/StatBadge（图标 + 折算值 + 必填 tooltip），图标取 lucide；
 * 纯展示，数据由页面注入，组件不自己发 stock/status。
 * 关键约束：remaining 为 null 时不渲染配额胶囊（不限流配置下宿主给不出数字）；
 * 图标须带 aria-hidden 与尺寸类，否则 lucide 默认尺寸会撑高胶囊。
 */
import { Gauge, ImageDown } from 'lucide-react'
import { StatBadge } from '@webview/components/StatBadge'
import type { JSX } from 'react'

interface StockQuotaBadgesProps {
    /** 已下载总张数 */
    total: number
    /** 本小时剩余配额：null 表示未知或未限流，此时不渲染该胶囊 */
    remaining: number | null
}

export function StockQuotaBadges({ total, remaining }: StockQuotaBadgesProps): JSX.Element {
    return (
        <>
            <StatBadge tooltip={`已下载到本地 ${String(total)} 张图片，可离线复用`}>
                <ImageDown aria-hidden className="size-3.5 font-light" />
                {`已下载 ${String(total)} 张`}
            </StatBadge>
            {remaining === null ? null : (
                <StatBadge tooltip={`本小时剩余约 ${String(remaining)} 次接口调用（取本地窗口与服务端剩余中较小者）`}>
                    <Gauge aria-hidden className="size-3.5 font-light" />
                    {`剩余 ${String(remaining)} 次`}
                </StatBadge>
            )}
        </>
    )
}
