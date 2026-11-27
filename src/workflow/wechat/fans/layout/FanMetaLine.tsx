/**
 * 用户描述行：并列展示关注时间、关注来源、黑名单、标签与 UnionID 徽标。
 * 复用约定：关注文案复用 fans/utils/fanText，徽标用 @webview/blocks/Badge，标签名由父层 Map 提供。
 * 关键约束：标签按 fan.tagIds 顺序展示，查不到名称的 id 跳过，避免脏数据渲染成空徽标。
 */
import { ItemDescription } from '@components/ui/item'
import type { WechatFanSummary } from '@shared/types/wechat'
import { Badge } from '@webview/blocks/Badge'
import type { JSX } from 'react'
import { formatFollowText } from '../utils/fanText'

interface FanMetaLineProps {
    fan: WechatFanSummary
    tagNameById: Map<number, string>
}

export function FanMetaLine({ fan, tagNameById }: FanMetaLineProps): JSX.Element {
    return (
        <ItemDescription className="flex flex-col gap-1">
            <span className=" truncate text-xs">
                {formatFollowText(fan)}
                {fan.subscribeScene === undefined || fan.subscribeScene.length === 0
                    ? null
                    : ` · 关注来源：${fan.subscribeScene}`}
            </span>
            <div className="flex flex-wrap items-center gap-1">
                {fan.isBlocked ? <Badge variant="destructive">已拉黑</Badge> : null}
                {fan.tagIds.map((id) => {
                    const name = tagNameById.get(id)
                    return name === undefined ? null : (
                        <Badge key={id} variant="secondary">
                            {name}
                        </Badge>
                    )
                })}
                {fan.unionid === undefined ? null : (
                    <Badge variant="outline" tooltip={fan.unionid}>
                        UnionID
                    </Badge>
                )}
            </div>
        </ItemDescription>
    )
}
