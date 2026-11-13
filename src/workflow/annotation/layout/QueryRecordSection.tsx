/**
 * AI 解释区块：标注页里的解释记录（按文本聚合），含关键词搜索与手动刷新。
 * 复用约定：容器取 Card 槽位、条目取同目录 QueryRecordItem、空态取 StateEmpty、提示条取 Alert、
 * 输入取 Input、按钮取 Button；数据与删除编排在 hooks/useQueryRecords。
 * 关键约束：必须保留刷新入口——在编辑器里查完再切回标注页时面板不会重新挂载，列表会停在旧数据；
 * 这里只关心「文本 + 结果」，不展示来源文档、不提供跳转，因此没有跳转失败的提示分支。
 */
import { Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { ItemGroup } from '@components/ui/item'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { QueryRecordItem } from './QueryRecordItem'
import type { JSX } from 'react'
import { useQueryRecords } from '../hooks/useQueryRecords'

export function QueryRecordSection(): JSX.Element {
    const { items, total, isLoading, error, keyword, setKeyword, reload, remove } = useQueryRecords()

    return (
        <Card>
            <CardHeader>
                <CardTitle>AI 解释（{total}）</CardTitle>
                <CardDescription>从编辑区选中的文字或整块发起的解释查询，按时间倒序</CardDescription>
                <CardAction className="flex items-center gap-2">
                    <Input
                        value={keyword}
                        placeholder="搜索原文 / 问题 / 答案"
                        className="h-8 w-44 text-xs"
                        onChange={(event): void => {
                            setKeyword(event.target.value)
                        }}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        isLoading={isLoading}
                        onClick={(): void => {
                            void reload()
                        }}
                    >
                        刷新
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                {error === null ? null : (
                    <Alert>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                {items.length === 0 ? (
                    <StateEmpty
                        title={isLoading ? '正在读取 AI 解释' : '还没有 AI 解释'}
                        description={isLoading ? undefined : '在编辑区选中文字或点块把手，选择「询问 AI」'}
                        icon={Sparkles}
                        isLoading={isLoading}
                    />
                ) : (
                    <ItemGroup>
                        {items.map((item) => (
                            <QueryRecordItem key={item.id} item={item} onRemove={remove} />
                        ))}
                    </ItemGroup>
                )}
            </CardContent>
        </Card>
    )
}
