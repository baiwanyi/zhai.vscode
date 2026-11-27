/**
 * 用户列表：按快照顺序组装行组件，空态给出筛选与未同步两种提示。
 * 复用约定：列表骨架用 ui/item，标签索引由 fans/utils/tagLookup 构造后下传；
 * 行内状态图标、描述、备注、标签与拉黑分别取同目录独立组件，空态用 Empty，复制走 shared/utils/clipboard。
 * 关键约束：OpenID 作为稳定 key；对外仅暴露 WechatFanListProps，行内状态与草稿全部下放；
 * 标签查找走父层 Map 与行内 Set，避免渲染期线性扫描，写操作期间由页面统一禁用按钮。
 */
import { Copy, Users } from 'lucide-react'
import { useMemo } from 'react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@components/ui/item'
import type { WechatFanSummary, WechatFanTag } from '@shared/types/wechat'
import { copyWithToast } from '@shared/utils/clipboard'
import { Badge } from '@webview/blocks/Badge'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { FanBlockAction } from './FanBlockAction'
import { FanMetaLine } from './FanMetaLine'
import { FanRemarkEditor } from './FanRemarkEditor'
import { FanStatusIcon } from './FanStatusIcon'
import { FanTagEditor } from './FanTagEditor'
import type { JSX } from 'react'
import { buildTagNameById } from '../utils/tagLookup'

interface WechatFanListProps {
    fans: WechatFanSummary[]
    tags: WechatFanTag[]
    /** 是否处于筛选态：决定空态文案 */
    hasFilter: boolean
    isMutating: boolean
    onBlacklist: (openid: string, action: 'block' | 'unblock') => Promise<boolean>
    onRemark: (openid: string, remark: string) => Promise<boolean>
    onToggleTag: (openid: string, tagId: number, action: 'add' | 'remove') => Promise<boolean>
}

interface WechatFanListItemProps {
    fan: WechatFanSummary
    tags: WechatFanTag[]
    tagNameById: Map<number, string>
    isMutating: boolean
    onBlacklist: (openid: string, action: 'block' | 'unblock') => Promise<boolean>
    onRemark: (openid: string, remark: string) => Promise<boolean>
    onToggleTag: (openid: string, tagId: number, action: 'add' | 'remove') => Promise<boolean>
}

/** 单行组装：OpenID 标题与复制、状态图标、描述行及三个行内操作入口 */
function WechatFanListItem({
    fan,
    tags,
    tagNameById,
    isMutating,
    onBlacklist,
    onRemark,
    onToggleTag,
}: WechatFanListItemProps): JSX.Element {
    return (
        <Item variant="outline" size="sm" className="flex-nowrap">
            <FanStatusIcon fan={fan} />
            <ItemContent className="min-w-0 flex-1">
                <ItemTitle className="flex w-full items-center gap-1">
                    <span className="min-w-0 truncate">{fan.openid}</span>
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`复制 ${fan.openid}`}
                        tooltip="复制 OpenID"
                        onClick={() => void copyWithToast(fan.openid, '已复制 OpenID')}
                    >
                        <Copy className="size-3.5" />
                    </Button>
                    {fan.remark === undefined || fan.remark.length === 0 ? null : (
                        <Badge variant="outline">{fan.remark}</Badge>
                    )}
                </ItemTitle>
                <FanMetaLine fan={fan} tagNameById={tagNameById} />
            </ItemContent>
            <ItemActions className="gap-1">
                <FanRemarkEditor fan={fan} isMutating={isMutating} onRemark={onRemark} />
                <FanTagEditor fan={fan} tags={tags} isMutating={isMutating} onToggleTag={onToggleTag} />
                <FanBlockAction fan={fan} isMutating={isMutating} onBlacklist={onBlacklist} />
            </ItemActions>
        </Item>
    )
}

export function WechatFanList({
    fans,
    tags,
    hasFilter,
    isMutating,
    onBlacklist,
    onRemark,
    onToggleTag,
}: WechatFanListProps): JSX.Element {
    const tagNameById = useMemo(() => buildTagNameById(tags), [tags])

    if (fans.length === 0) {
        return (
            <Empty
                icon={Users}
                title={hasFilter ? '无匹配用户' : '暂无用户'}
                description={
                    hasFilter
                        ? '调整关键词或筛选条件；仅检索已同步数据。'
                        : '点击「同步」拉取关注者，或等待实时数据。'
                }
            />
        )
    }

    return (
        <ItemGroup>
            {fans.map((fan) => (
                <WechatFanListItem
                    key={fan.openid}
                    fan={fan}
                    tags={tags}
                    tagNameById={tagNameById}
                    isMutating={isMutating}
                    onBlacklist={onBlacklist}
                    onRemark={onRemark}
                    onToggleTag={onToggleTag}
                />
            ))}
        </ItemGroup>
    )
}
