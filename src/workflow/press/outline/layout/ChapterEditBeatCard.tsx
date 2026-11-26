/**
 * 节拍卡片：一张 Card 承载章纲下的一组可勾选叙事单位，勾选表示正文已兑现该节拍。
 * 复用约定：卡片取 @components/ui/card，节拍行复用 outline/block 的 ToggleCheckItem 承载勾选语义，文本沿用 ui/input 的无边框写法，
 * 行尾操作取 ui/button 的 ghost 变体，空列表用 blocks/Empty 占位，新节拍用 press/utils 的 createBeat 创建。
 * 关键约束：勾选、排序与增删都回传新的数组，不原地修改传入的 beats；
 * 每条节拍的输入框带序号化可访问名称；行操作按钮悬停或键盘聚焦时才显现。
 */
import { cn } from 'cn'
import { ListTodo, MoveUp, Plus, Trash2 } from 'lucide-react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { ItemGroup } from '@components/ui/item'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import type { OutlineBeat } from '../../types'
import type { JSX } from 'react'
import { createBeat } from '../../utils'
import { ToggleCheckItem } from '../block/ToggleCheckItem'

/** 行尾操作按钮显隐：悬停整行或键盘聚焦按钮时显现 */
const ROW_ACTION_CLASS = 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'

interface ChapterEditBeatCardProps {
    beats: OutlineBeat[]
    onChange: (beats: OutlineBeat[]) => void
}

/** 节拍卡片：列表与添加入口自洽，调用方只需回传 beats 补丁 */
export function ChapterEditBeatCard({ beats, onChange }: ChapterEditBeatCardProps): JSX.Element {
    const handleToggle = (beatId: string): void => {
        onChange(beats.map((beat) => (beat.id === beatId ? { ...beat, isDone: !beat.isDone } : beat)))
    }

    const handleTextChange = (beatId: string, text: string): void => {
        onChange(beats.map((beat) => (beat.id === beatId ? { ...beat, text } : beat)))
    }

    const handleRemove = (beatId: string): void => {
        onChange(beats.filter((beat) => beat.id !== beatId))
    }

    const handleMoveUp = (index: number): void => {
        if (index === 0) {
            return
        }
        const next = [...beats]
        const current = next[index]
        const previous = next[index - 1]
        if (!current || !previous) {
            return
        }
        next[index - 1] = current
        next[index] = previous
        onChange(next)
    }

    const handleAdd = (): void => {
        onChange([...beats, createBeat()])
    }

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>节拍</CardTitle>
                <CardAction>
                    <Button variant="secondary" size="icon-xs" tooltip="添加节拍" onClick={handleAdd}>
                        <Plus />
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                {beats.length === 0 ? (
                    <Empty
                        icon={ListTodo}
                        title="还没有节拍"
                        description="添加节拍，把这一章拆成几个可兑现的叙事单位"
                        className="py-6"
                    />
                ) : (
                    <ItemGroup className="has-data-[size=xs]:gap-0.5">
                        {beats.map((beat, index) => (
                            <ToggleCheckItem
                                key={beat.id}
                                isSelected={beat.isDone}
                                ariaLabel={
                                    beat.isDone ? `取消兑现第 ${index + 1} 条节拍` : `标记第 ${index + 1} 条节拍已兑现`
                                }
                                onToggle={() => handleToggle(beat.id)}
                                variant="muted"
                                title={
                                    <Input
                                        value={beat.text}
                                        aria-label={`第 ${index + 1} 条节拍`}
                                        placeholder="谁、在哪、做了什么、留下什么"
                                        className={cn(
                                            'border-transparent bg-transparent dark:border-transparent dark:bg-transparent focus-visible:border-input focus-visible:ring-0',
                                            beat.isDone && 'text-muted-foreground line-through',
                                        )}
                                        onChange={(event) => handleTextChange(beat.id, event.target.value)}
                                    />
                                }
                            >
                                {index > 0 ? (
                                    <Button
                                        variant="secondary"
                                        size="icon"
                                        className={ROW_ACTION_CLASS}
                                        aria-label={`上移第 ${index + 1} 条节拍`}
                                        onClick={() => handleMoveUp(index)}
                                    >
                                        <MoveUp />
                                    </Button>
                                ) : null}
                                <Button
                                    variant="destructive"
                                    size="icon"
                                    className={ROW_ACTION_CLASS}
                                    aria-label={`删除第 ${index + 1} 条节拍`}
                                    onClick={() => handleRemove(beat.id)}
                                >
                                    <Trash2 />
                                </Button>
                            </ToggleCheckItem>
                        ))}
                    </ItemGroup>
                )}
            </CardContent>
        </Card>
    )
}
