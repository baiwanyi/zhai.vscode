/**
 * 分组列表：展示「我的分组」全部条目，点击由页面切换到该分组的信息流。
 * 复用约定：卡片骨架取 @components/ui/card，按钮取 @webview/components/Button，
 * 加载态与空态复用 StateEmpty；分组数据已由宿主归一化，这里只渲染标题与自建标记。
 * 关键约束：列表为空时给出重试入口而不是白屏；点击只派发所选分组，不自行取数。
 */
import { Users } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardContent } from '@components/ui/card'
import type { WeiboGroupItem } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { JSX } from 'react'

interface WeiboGroupListProps {
    groups: WeiboGroupItem[]
    isLoading: boolean
    errorMessage: string | null
    onSelect: (group: WeiboGroupItem) => void
    onReload: () => void
}

export function WeiboGroupList({
    groups,
    isLoading,
    errorMessage,
    onSelect,
    onReload,
}: WeiboGroupListProps): JSX.Element {
    if (isLoading) {
        return <StateEmpty className="py-8" title="正在读取分组..." isLoading />
    }
    if (groups.length === 0) {
        return (
            <StateEmpty
                className="py-8"
                icon={Users}
                title="还没有自建分组"
                description={errorMessage ?? '分组需要先在微博网页端创建，创建后回到这里刷新一次即可看到。'}
            >
                <Button size="sm" variant="outline" onClick={onReload}>
                    刷新分组
                </Button>
            </StateEmpty>
        )
    }
    return (
        <Card>
            <CardContent className="flex flex-col gap-2">
                <h2 className="font-medium">我的分组</h2>
                <div className="flex flex-wrap gap-1.5">
                    {groups.map((group) => (
                        <Button
                            key={group.gid}
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                onSelect(group)
                            }}
                        >
                            {group.title}
                            {group.isCustom ? null : (
                                <Badge variant="secondary" className="ml-1">
                                    系统
                                </Badge>
                            )}
                        </Button>
                    ))}
                </div>
                <p className="text-muted-foreground text-xs">
                    选择分组后按该分组的 list_id 拉取信息流，游标翻页只在该分组内生效。
                </p>
            </CardContent>
        </Card>
    )
}
