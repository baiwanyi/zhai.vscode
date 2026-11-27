/**
 * 标签列表：展示公众号标签与平台人数，点击标签跳转到该标签的用户筛选。
 * 复用约定：列表骨架用 ui/item，人数用 Button 展示并兼作选中入口，空态与错误态用 Empty，行内操作用 Button；
 * 重命名与删除只发命令，写操作由页面 hook 提交后回读。
 * 关键约束：写操作期间禁用重命名与删除按钮避免并发提交，人数按钮是筛选入口不属写操作；
 * 人数按钮点击即跳转用户段，不是切换开关，不设 aria-pressed；列表不感知当前筛选标签；
 * 三个按钮均带 tooltip 与 aria-label，文案统一为跳转语义，不依赖会被 Tooltip 覆盖的 data-state；
 * 空态提示标签由公众号后台同步而来，不把「没有标签」误报为读取失败。
 */
import { SquarePen, Tags, Trash2, UserGroup } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@components/ui/item'
import type { WechatFanTag } from '@shared/types/wechat'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface WechatTagListProps {
    tags: WechatFanTag[]
    tagsError: string | null
    isMutating: boolean
    onSelectTag: (id: number) => void
    onRename: (tag: WechatFanTag) => void
    onRemove: (tag: WechatFanTag) => void
}

export function WechatTagList({
    tags,
    tagsError,
    isMutating,
    onSelectTag,
    onRename,
    onRemove,
}: WechatTagListProps): JSX.Element {
    if (tagsError !== null) {
        return <Empty icon={Tags} title="标签读取失败" description={tagsError} />
    }
    if (tags.length === 0) {
        return (
            <Empty
                icon={Tags}
                title="还没有标签"
                description="标签需要在公众号后台创建；同步用户数据后会在这里展示名称与人数。"
            />
        )
    }

    return (
        <ItemGroup>
            {tags.map((tag) => (
                <Item key={tag.id} variant="outline" size="sm">
                    <ItemContent>
                        <ItemTitle className="flex w-full items-center gap-1">
                            <span className="min-w-0 truncate">{tag.name}</span>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                tooltip={`重命名${tag.name}`}
                                aria-label={`重命名${tag.name}`}
                                disabled={isMutating}
                                onClick={() => onRename(tag)}
                            >
                                <SquarePen className="size-3.5" />
                            </Button>
                        </ItemTitle>
                    </ItemContent>
                    <ItemActions className="gap-1">
                        <Button
                            variant="secondary"
                            size="sm"
                            tooltip={`查看${tag.name}的用户`}
                            aria-label={`查看${tag.name}的用户，${String(tag.count)} 人`}
                            onClick={() => onSelectTag(tag.id)}
                        >
                            <UserGroup className="size-3.5" />
                            {`${String(tag.count)} 人`}
                        </Button>
                        <Button
                            variant="destructive"
                            size="icon-xs"
                            tooltip={`删除${tag.name}`}
                            aria-label={`删除${tag.name}`}
                            disabled={isMutating}
                            onClick={() => onRemove(tag)}
                        >
                            <Trash2 className="size-3.5" />
                        </Button>
                    </ItemActions>
                </Item>
            ))}
        </ItemGroup>
    )
}
