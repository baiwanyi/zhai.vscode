/**
 * 卷纲页：每卷一张卡片，卡片只读展示核心事件，点击整卡打开对话框编辑这一卷的卷纲。
 * 复用约定：卡片取 ui/card，空态取 blocks/StateEmpty，更多操作取 ui/dropdown-menu，
 * 编辑弹层由同目录 OutlineVolumeEditDialog 承担（卷标题 / 章节数 / 核心事件 / 主要情节 / 关键转折 / 卷末结果）。
 * 关键约束：卡片不直接改数据，编辑与保存都在弹层里完成，本组件只持有「正在编辑哪一卷」；
 * 整卡点击只打开编辑弹层，更多菜单的触发器与菜单内容都要阻止冒泡，否则会连带触发弹层；
 * 菜单只上报动作（编辑 / 上移 / 下移 / 生成章纲 / 清空章纲 / 添加到 AI 对话 / 删除），顺序调整与清空由页面落盘；
 * 新增卷入口在页头动作菜单，进入章纲页走页头模块切换 + 卷筛选，这里不再放入口。
 */
import {
    ArrowDown,
    ArrowUp,
    Ellipsis,
    Eraser,
    ListTree,
    MessageSquarePlus,
    Pencil,
    Sparkles,
    Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import { OutlineVolumeEditDialog } from './OutlineVolumeEditDialog'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { JSX } from 'react'
import { volumeTitleLabel } from '../../utils'

interface OutlineVolumeCardsProps {
    volumes: OutlineVolume[]
    /** 作品设定：编辑弹层里 AI 生成核心事件 / 卷末结果时作为事实输入 */
    setting: ProjectSetting
    /** 人物卡：同上，提供可出场人物 */
    characters: CharacterCard[]
    /** 保存一卷的卷纲补丁：由编辑弹层一次性回传 */
    onUpdate: (volumeId: string, patch: Partial<OutlineVolume>) => void
    /** 上移一位：顺序即卷号，页面按新顺序整体落盘 */
    onMoveUp: (volume: OutlineVolume) => void
    /** 下移一位：同上 */
    onMoveDown: (volume: OutlineVolume) => void
    /** 打开「按卷生成章纲」对话框 */
    onGenerateChapters: (volume: OutlineVolume) => void
    /** 清空这一卷的章纲：页面确认后移除该卷全部章节条目，只留卷纲 */
    onClearChapters: (volume: OutlineVolume) => void
    /** 添加到 AI 对话：把卷纲快照交给页面复制并切到对话分区 */
    onAddToChat: (volume: OutlineVolume, index: number) => void
    /** 删除这一卷：页面弹确认后整体落盘 */
    onDelete: (volume: OutlineVolume) => void
}

export function OutlineVolumeCards({
    volumes,
    setting,
    characters,
    onUpdate,
    onMoveUp,
    onMoveDown,
    onGenerateChapters,
    onClearChapters,
    onAddToChat,
    onDelete,
}: OutlineVolumeCardsProps): JSX.Element {
    const [editingVolumeId, setEditingVolumeId] = useState<string | null>(null)
    const editingVolume = volumes.find((volume) => volume.id === editingVolumeId) ?? null

    const handleOpenEdit = (volume: OutlineVolume): void => {
        setEditingVolumeId(volume.id)
    }

    const handleEditOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            setEditingVolumeId(null)
        }
    }

    return (
        // 滚动交给外层 AppContent 的 ScrollArea：这里只排布内容，不再自带 overflow，避免嵌套滚动
        <div className="flex flex-col gap-3 py-3">
            {volumes.length === 0 ? (
                <StateEmpty
                    icon={ListTree}
                    title="还没有卷"
                    description="用页头「大纲操作」新增一卷，再写下核心事件与主要情节"
                />
            ) : (
                <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
                    {volumes.map((volume, index) => {
                        const title = volumeTitleLabel(volume.name, index)
                        return (
                            <Card
                                key={volume.id}
                                role="button"
                                tabIndex={0}
                                aria-label={`编辑卷纲：${title}`}
                                className="cursor-pointer transition-colors hover:border-primary/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                onClick={() => handleOpenEdit(volume)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        handleOpenEdit(volume)
                                    }
                                }}
                            >
                                <CardHeader>
                                    <CardTitle className="min-w-0 truncate">{title}</CardTitle>
                                    <CardDescription>
                                        已写 {volume.chapters.length} 章
                                        {volume.expectedChapters > 0
                                            ? ` · 规划 ${String(volume.expectedChapters)} 章`
                                            : ' · 规划章数未填'}
                                    </CardDescription>
                                    <CardAction className="flex items-center gap-1.5">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    tooltip="更多操作"
                                                    aria-label={`更多操作：${title}`}
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <Ellipsis />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            {/* 菜单渲染在 portal 里，点击仍会冒泡到整卡：这里整体拦掉，避免顺带打开编辑弹层 */}
                                            <DropdownMenuContent
                                                align="end"
                                                className="w-40"
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <DropdownMenuItem onSelect={() => handleOpenEdit(volume)}>
                                                    <Pencil />
                                                    编辑
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => onAddToChat(volume, index)}>
                                                    <MessageSquarePlus />
                                                    添加到 AI 对话
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    disabled={index === 0}
                                                    onSelect={() => onMoveUp(volume)}
                                                >
                                                    <ArrowUp />
                                                    上移
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    disabled={index === volumes.length - 1}
                                                    onSelect={() => onMoveDown(volume)}
                                                >
                                                    <ArrowDown />
                                                    下移
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onSelect={() => onGenerateChapters(volume)}>
                                                    <Sparkles />
                                                    生成章纲
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    variant="destructive"
                                                    disabled={volume.chapters.length === 0}
                                                    onSelect={() => onClearChapters(volume)}
                                                >
                                                    <Eraser />
                                                    清空章纲
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    variant="destructive"
                                                    onSelect={() => onDelete(volume)}
                                                >
                                                    <Trash2 />
                                                    删除
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </CardAction>
                                </CardHeader>
                                <CardContent>
                                    {volume.coreEvent.trim().length > 0 ? (
                                        <p className="whitespace-pre-line text-muted-foreground">{volume.coreEvent}</p>
                                    ) : (
                                        <p className="text-muted-foreground/70">还没有核心事件，点击卡片填写</p>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* key 绑定「卷 id + 打开状态」：每次打开都重建弹层，草稿不会串到上一卷或上一次编辑 */}
            <OutlineVolumeEditDialog
                key={`${editingVolumeId ?? 'none'}-${editingVolume === null ? 'closed' : 'open'}`}
                isOpen={editingVolume !== null}
                onOpenChange={handleEditOpenChange}
                volume={editingVolume}
                setting={setting}
                characters={characters}
                onSave={onUpdate}
            />
        </div>
    )
}
