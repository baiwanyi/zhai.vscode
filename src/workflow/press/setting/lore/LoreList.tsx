/**
 * 资料条目列表：以单列卡片展示当前分类的条目，承担浏览、选中与删除入口。
 * 复用约定：卡片复用 ui/card，删除确认复用 components/ConfirmDialog，缩略图与缺图占位复用 components/Image，
 * 空态复用 ui/empty，文案与图标取自 constants 的 LORE_KIND_META。
 * 关键约束：卡片是 role=button 的可聚焦容器，删除按钮挂在外层容器，避免点删除时顺带触发选中；
 * 描述只显示首行，势力卡片额外显示关联人数，其余分类不出现该徽标；
 * 排序沿用草稿顺序（即文档顺序），不按名称重排——作者可以在 Markdown 里自己调整先后。
 */
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Card } from '@components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { Image } from '@webview/components/Image'
import type { LoreEntry, LoreKind } from '../../types'
import type { JSX } from 'react'
import { LORE_KIND_META } from '../../constants'

interface LoreListProps {
    kind: LoreKind
    /** 已按分类与搜索收敛过的条目 */
    entries: LoreEntry[]
    /** 当前分类的条目总数，用于区分「一条都没有」与「没有匹配」 */
    totalCount: number
    /** 是否处于搜索状态，决定空态提供的出口 */
    hasFilter: boolean
    /** 条目标识 → 封面地址：由调用方批量回读后传入，缺项按未设置封面处理 */
    coverUrls: Readonly<Record<string, string>>
    onSelect: (id: string) => void
    onCreate: () => void
    onClearFilter: () => void
    /** 删除条目：由调用方同步清理设定图与文档块 */
    onDelete: (id: string) => void
}

export function LoreList({
    kind,
    entries,
    totalCount,
    hasFilter,
    coverUrls,
    onSelect,
    onCreate,
    onClearFilter,
    onDelete,
}: LoreListProps): JSX.Element {
    /** 待确认删除的条目：非空时弹出二次确认，避免误触删掉整条设定 */
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const deleting = entries.find((entry) => entry.id === deletingId) ?? null
    const meta = LORE_KIND_META[kind]

    if (entries.length === 0) {
        return (
            <Empty className="border border-dashed border-border">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <meta.icon />
                    </EmptyMedia>
                    <EmptyTitle>{totalCount === 0 ? meta.emptyTitle : `没有匹配的${meta.label}`}</EmptyTitle>
                    <EmptyDescription>
                        {totalCount === 0 ? meta.emptyDescription : '换个关键词，或清空搜索后重新浏览'}
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    {totalCount === 0 ? (
                        <Button variant="outline" onClick={onCreate}>
                            <Plus />
                            新增{meta.label}
                        </Button>
                    ) : (
                        <Button variant="ghost" disabled={!hasFilter} onClick={onClearFilter}>
                            清空搜索
                        </Button>
                    )}
                </EmptyContent>
            </Empty>
        )
    }

    return (
        <>
            <div className="flex flex-col gap-2 pt-1">
                {entries.map((entry) => {
                    const summary = entry.description.trim().split(/\r?\n/u)[0] ?? ''
                    const memberCount = kind === 'faction' ? entry.memberIds.length : 0
                    return (
                        // 删除按钮挂在外层容器：卡片本身是 role=button，内嵌按钮会连带触发选中
                        <div key={entry.id} className="group relative">
                            <Card
                                size="sm"
                                role="button"
                                tabIndex={0}
                                className="cursor-pointer flex-row items-center gap-2.5 p-2 pr-9 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                                onClick={() => onSelect(entry.id)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') {
                                        return
                                    }
                                    event.preventDefault()
                                    onSelect(entry.id)
                                }}
                            >
                                {/* 宽度必须先定死：Image 自带 size-full，flex 行内没有外层宽度会与文字区争空间 */}
                                <div className="w-12 shrink-0">
                                    <Image
                                        src={coverUrls[entry.id] ?? ''}
                                        alt={`${entry.name} 的设定图`}
                                        aspect="3/4"
                                        size="sm"
                                    />
                                </div>

                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="min-w-0 truncate font-medium">{entry.name}</span>
                                        {memberCount > 0 ? (
                                            <Badge variant="secondary" className="shrink-0">
                                                关联 {String(memberCount)} 人
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <p className="truncate text-muted-foreground">
                                        {summary.length > 0 ? summary : '描述未填写'}
                                    </p>
                                </div>
                            </Card>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-1 right-1 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                                aria-label={`删除${meta.label} ${entry.name}`}
                                tooltip={`删除${meta.label}`}
                                onClick={() => setDeletingId(entry.id)}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </div>
                    )
                })}
            </div>

            <ConfirmDialog
                open={deleting !== null}
                title={`删除「${deleting?.name ?? ''}」？`}
                description={`${meta.label}会立即从 ${meta.label}.md 中移除，已生成的设定图移入回收站。`}
                confirmLabel={`删除${meta.label}`}
                isDestructive
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setDeletingId(null)
                    }
                }}
                onConfirm={() => {
                    const target = deletingId
                    setDeletingId(null)
                    if (target !== null) {
                        onDelete(target)
                    }
                }}
            />
        </>
    )
}
