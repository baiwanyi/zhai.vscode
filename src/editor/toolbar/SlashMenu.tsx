/**
 * 斜杠命令弹层：列出可用命令，支持键盘上下选择与回车执行。
 * 复用约定：Popover 承载浮层（锚点为零尺寸 fixed 元素），Button 承载条目；
 * 会话状态来自 slashStore，键盘处理器注册回 store 供编辑器转调。
 * 关键约束：列表长度变化时必须夹紧选中项，否则删字符后回车会取到 undefined；
 * 浮层一律阻止默认焦点行为，避免焦点离开编辑器导致 Suggestion 直接退出、菜单闪一下就消失。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { Button } from '@webview/components/Button'
import { getSlashSession, setSlashKeyHandler, setSlashSession, subscribeSlash } from './slashStore'
import type { JSX } from 'react'

export function SlashMenu(): JSX.Element | null {
    const session = useSyncExternalStore(subscribeSlash, getSlashSession, getSlashSession)
    const [selectedIndex, setSelectedIndex] = useState(0)

    const items = useMemo(() => session?.items ?? [], [session])
    const itemCount = items.length
    // 列表变短时夹紧选中项：不在 effect 里 setState，直接按边界取值，避免多一轮渲染
    const activeIndex = itemCount === 0 ? 0 : Math.min(selectedIndex, itemCount - 1)

    // 注册键盘处理：上下移动、回车执行、Esc 关闭；编辑器侧只负责把按键转过来
    useEffect(() => {
        if (session === null || itemCount === 0) {
            return
        }
        const runAt = (index: number): void => {
            const target = items[index]
            if (target === undefined) {
                return
            }
            session.run(target)
            setSlashSession(null)
        }
        setSlashKeyHandler((event) => {
            if (event.key === 'ArrowDown') {
                setSelectedIndex((previous) => (previous + 1) % itemCount)
                return true
            }
            if (event.key === 'ArrowUp') {
                setSelectedIndex((previous) => (previous - 1 + itemCount) % itemCount)
                return true
            }
            if (event.key === 'Enter') {
                runAt(activeIndex)
                return true
            }
            if (event.key === 'Escape') {
                setSlashSession(null)
                return true
            }
            return false
        })
        return (): void => {
            setSlashKeyHandler(null)
        }
    }, [activeIndex, itemCount, items, session])

    if (session === null) {
        return null
    }

    return (
        <Popover open>
            <PopoverAnchor asChild>
                <div className="pointer-events-none fixed h-0 w-0" style={session.anchor} />
            </PopoverAnchor>
            <PopoverContent
                side="bottom"
                align="start"
                className="w-64 p-1"
                onOpenAutoFocus={(event): void => {
                    event.preventDefault()
                }}
                onMouseDown={(event): void => {
                    event.preventDefault()
                }}
            >
                {items.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">没有匹配的命令</p>
                ) : (
                    <div className="flex flex-col">
                        {items.map((item, index) => (
                            <Button
                                key={item.id}
                                variant={index === activeIndex ? 'secondary' : 'ghost'}
                                size="sm"
                                className="justify-start"
                                onMouseEnter={(): void => {
                                    setSelectedIndex(index)
                                }}
                                onClick={(): void => {
                                    session.run(item)
                                    setSlashSession(null)
                                }}
                            >
                                <item.icon className="size-4" />
                                <span>{item.label}</span>
                                <span className="ml-auto text-xs text-muted-foreground">{item.hint}</span>
                            </Button>
                        ))}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
