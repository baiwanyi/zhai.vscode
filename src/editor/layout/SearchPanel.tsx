/**
 * 查找条：关键字输入 + 命中计数 + 上一个 / 下一个 + 关闭。
 * 复用约定：Input / Button 取项目既有封装，浮层用绝对定位贴在内容区右上角，
 * 不引入 Popover——查找条需要常驻，弹层式交互会让输入框失焦。
 * 关键约束：Enter 下一个、Shift+Enter 上一个、Esc 关闭，这三条是查找条的默认预期，
 * 缺任何一个用户都会试图用鼠标点按钮，长文里效率立刻下降。
 */
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { Input } from '@components/ui/input'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

export interface SearchPanelProps {
    query: string
    matchCount: number
    activeIndex: number
    isCapped: boolean
    onQueryChange: (query: string) => void
    onNext: () => void
    onPrev: () => void
    onClose: () => void
}

/** 计数文案：无命中时说「无结果」，命中上限时提示细化关键词 */
function readCounterLabel(matchCount: number, activeIndex: number, isCapped: boolean): string {
    if (matchCount === 0) {
        return '无结果'
    }
    const label = `${String(activeIndex + 1)} / ${String(matchCount)}`
    return isCapped ? `${label}+` : label
}

export function SearchPanel({
    query,
    matchCount,
    activeIndex,
    isCapped,
    onQueryChange,
    onNext,
    onPrev,
    onClose,
}: SearchPanelProps): JSX.Element {
    return (
        <div className="absolute right-4 top-2 z-20 flex items-center gap-1 rounded-md border bg-background/95 px-2 py-1 shadow-sm backdrop-blur">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
                autoFocus
                value={query}
                placeholder="查找"
                className="h-7 w-44 border-0 px-1 text-sm shadow-none focus-visible:ring-0"
                onChange={(event): void => {
                    onQueryChange(event.target.value)
                }}
                onKeyDown={(event): void => {
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        if (event.shiftKey) {
                            onPrev()
                            return
                        }
                        onNext()
                        return
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault()
                        onClose()
                    }
                }}
            />
            <span className="min-w-14 text-right text-xs tabular-nums text-muted-foreground">
                {readCounterLabel(matchCount, activeIndex, isCapped)}
            </span>
            <Button variant="ghost" size="icon-xs" aria-label="上一个" disabled={matchCount === 0} onClick={onPrev}>
                <ChevronUp className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="下一个" disabled={matchCount === 0} onClick={onNext}>
                <ChevronDown className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="关闭查找" onClick={onClose}>
                <X className="size-3.5" />
            </Button>
        </div>
    )
}
