/**
 * 节拍列表：章纲下的一组可勾选叙事单位，勾选表示正文已经兑现该节拍。
 * 复用约定：勾选态用 ui/button 的 ghost 变体承载图标，文本沿用 ui/input 的无边框写法，
 * 行操作按钮在悬停或键盘聚焦时才显现，保持窄栏下的视觉安静。
 * 关键约束：勾选与排序都必须回传新的数组，不原地修改传入的 beats；
 * 每条节拍的输入框需带序号化的可访问名称，否则读屏只能听到一串无名文本框。
 */
import { cn } from 'cn'
import { CheckSquare, MoveUp, Plus, Square, Trash2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import type { OutlineBeat } from '../types'
import type { JSX } from 'react'

interface OutlineBeatListProps {
    beats: OutlineBeat[]
    onChange: (beats: OutlineBeat[]) => void
    onAdd: () => void
}

export function OutlineBeatList({ beats, onChange, onAdd }: OutlineBeatListProps): JSX.Element {
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

    return (
        <div className="flex flex-col gap-0.5">
            {beats.map((beat, index) => (
                <div
                    key={beat.id}
                    className="group flex items-center gap-0.5 rounded-lg px-0.5 hover:bg-muted/50 focus-within:bg-muted/50"
                >
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0 rounded-full"
                        aria-label={beat.isDone ? `取消兑现第 ${index + 1} 条节拍` : `标记第 ${index + 1} 条节拍已兑现`}
                        aria-pressed={beat.isDone}
                        onClick={() => handleToggle(beat.id)}
                    >
                        {beat.isDone ? (
                            <CheckSquare className="text-chart-2" aria-hidden="true" />
                        ) : (
                            <Square aria-hidden="true" />
                        )}
                    </Button>
                    <Input
                        value={beat.text}
                        aria-label={`第 ${index + 1} 条节拍`}
                        placeholder="谁、在哪、做了什么、留下什么"
                        className={cn(
                            'h-8 flex-1 border-transparent bg-transparent px-1 text-xs shadow-none focus-visible:border-input',
                            beat.isDone && 'text-muted-foreground line-through',
                        )}
                        onChange={(event) => handleTextChange(beat.id, event.target.value)}
                    />
                    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={`上移第 ${index + 1} 条节拍`}
                            disabled={index === 0}
                            onClick={() => handleMoveUp(index)}
                        >
                            <MoveUp />
                        </Button>
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={`删除第 ${index + 1} 条节拍`}
                            onClick={() => handleRemove(beat.id)}
                        >
                            <Trash2 />
                        </Button>
                    </div>
                </div>
            ))}
            <Button size="xs" variant="ghost" className="mt-1 w-fit rounded-full" onClick={onAdd}>
                <Plus data-icon="inline-start" />
                添加节拍
            </Button>
        </div>
    )
}
