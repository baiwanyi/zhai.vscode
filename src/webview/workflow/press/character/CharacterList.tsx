/**
 * 人物卡片列表：以单列卡片展示人物卡，承担人物页的主体浏览、选择与删除入口。
 * 复用约定：卡片复用 ui/card，删除确认复用 ui/alert-dialog，角色徽标取 CHARACTER_ROLE_META 的图表色，
 * 性别以 Mars / Venus 图标区分（男蓝女红），空态复用 ui/empty。
 * 关键约束：封面优先取磁盘画廊（宿主一次回读的全部角色图片），按 coverPortraitId 命中，未命中用最新一张，
 * 再退回到草稿里已加载的 portraits——文档只存封面 id，图片本体在 Portraits 下，不读磁盘就没有封面；
 * 卡片是可聚焦按钮而非占位容器，键盘可逐项进入；排序固定按 CHARACTER_ROLE_ORDER，不随点击顺序变化；
 * 删除按钮放在卡片外层容器而非卡片内部，避免点击删除时触发卡片的选中事件。
 */
import { cn } from 'cn'
import { Mars, Plus, Sparkles, Trash2, UserRound, Venus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Card } from '@components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import type { PortraitGalleryItem } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { Image } from '@webview/components/Image'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META, CHARACTER_ROLE_ORDER } from '../constants'

interface CharacterListProps {
    /** 已按筛选与搜索收敛过的人物卡 */
    characters: CharacterCard[]
    /** 全部人物数，用于区分「一个人都没有」与「没有匹配」 */
    totalCount: number
    /** 是否处于筛选或搜索状态，决定空态提供的出口 */
    hasFilter: boolean
    /** 作品下全部角色的设定图，键为人物 id：用于在不打开弹窗的情况下显示封面 */
    galleries: Readonly<Record<string, PortraitGalleryItem[]>>
    onSelect: (id: string) => void
    onCreate: () => void
    /** 空态下的第二个入口：从导入素材里提取人物卡，与页脚「提取」是同一动作 */
    onExtract: () => void
    onClearFilter: () => void
    /** 删除人物：由调用方同步清理章纲里的出场引用 */
    onDelete: (id: string) => void
}

/**
 * 取卡片封面地址：先按封面 id 在磁盘画廊里找，找不到用最新一张；
 * 画廊还没回读时退回到草稿里已加载的图，避免刚生成完保存后封面闪一下变空。
 */
function resolveCoverUrl(
    character: CharacterCard,
    galleries: Readonly<Record<string, PortraitGalleryItem[]>>,
): string | null {
    const items = galleries[character.id] ?? []
    const fromDisk = items.find((item) => item.id === character.coverPortraitId) ?? items[0]
    if (fromDisk !== undefined) {
        return fromDisk.url
    }
    const fromDraft =
        character.portraits.find((item) => item.id === character.coverPortraitId) ?? character.portraits[0]
    return fromDraft?.url ?? null
}

export function CharacterList({
    characters,
    totalCount,
    hasFilter,
    galleries,
    onSelect,
    onCreate,
    onExtract,
    onClearFilter,
    onDelete,
}: CharacterListProps): JSX.Element {
    /** 待确认删除的人物：非空时弹出二次确认，避免误触删掉整张卡 */
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const deleting = characters.find((character) => character.id === deletingId) ?? null
    const sortedCharacters = useMemo(
        () =>
            [...characters].sort(
                (left, right) => CHARACTER_ROLE_ORDER.indexOf(left.role) - CHARACTER_ROLE_ORDER.indexOf(right.role),
            ),
        [characters],
    )

    if (sortedCharacters.length === 0) {
        return (
            <Empty className="border border-dashed border-border py-8">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <UserRound />
                    </EmptyMedia>
                    <EmptyTitle>{totalCount === 0 ? '还没有人物' : '没有匹配的人物'}</EmptyTitle>
                    <EmptyDescription>
                        {totalCount === 0 ? '先建立主角与对手，大纲才能排布冲突' : '换个关键词，或切回「全部」分类'}
                    </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                    {totalCount === 0 ? (
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button variant="outline" onClick={onCreate}>
                                <Plus />
                                新增人物
                            </Button>
                            <Button variant="outline" onClick={onExtract}>
                                <Sparkles />
                                提取人物
                            </Button>
                        </div>
                    ) : (
                        <Button variant="ghost" disabled={!hasFilter} onClick={onClearFilter}>
                            清空筛选
                        </Button>
                    )}
                </EmptyContent>
            </Empty>
        )
    }

    return (
        <>
            <div className="flex flex-col gap-2">
                {sortedCharacters.map((character) => {
                    const roleMeta = CHARACTER_ROLE_META[character.role]
                    const summary = character.desire.length > 0 ? character.desire : '欲望未填写'
                    const coverUrl = resolveCoverUrl(character, galleries)
                    return (
                        // 删除按钮挂在外层容器：卡片本身是 role=button，内嵌按钮会连带触发选中
                        <div key={character.id} className="group relative">
                            <Card
                                size="sm"
                                role="button"
                                tabIndex={0}
                                className="cursor-pointer flex-row items-center gap-2.5 p-2 pr-9 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                                onClick={() => onSelect(character.id)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') {
                                        return
                                    }
                                    event.preventDefault()
                                    onSelect(character.id)
                                }}
                            >
                                {/* 宽度必须先定死：Image 自带 size-full，flex 行内没有外层宽度会与文字区争空间 */}
                                <div className="w-12 shrink-0">
                                    <Image
                                        src={coverUrl || ''}
                                        alt={`${character.name} 的角色封面`}
                                        aspect="3/4"
                                        size="sm"
                                    />
                                </div>

                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="min-w-0 truncate font-medium">{character.name}</span>
                                        <Badge className={cn('shrink-0', roleMeta.className)}>{roleMeta.label}</Badge>
                                        {character.gender === 'male' ? (
                                            <Mars
                                                className="size-3.5 shrink-0 text-chart-1"
                                                role="img"
                                                aria-label="男"
                                            />
                                        ) : (
                                            <Venus
                                                className="size-3.5 shrink-0 text-chart-5"
                                                role="img"
                                                aria-label="女"
                                            />
                                        )}
                                    </div>
                                    <p className="truncate text-muted-foreground">
                                        {character.identity.length > 0 ? character.identity : '未填写身份'}
                                    </p>
                                    <p className="truncate text-muted-foreground">{summary}</p>
                                </div>
                            </Card>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-1 right-1 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                                aria-label={`删除人物 ${character.name}`}
                                tooltip="删除人物"
                                onClick={() => setDeletingId(character.id)}
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
                description="人物卡会立即从角色设定.md 中移除，章纲里的出场引用一并清理，已生成的角色设定图移入回收站。"
                confirmLabel="删除人物"
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
