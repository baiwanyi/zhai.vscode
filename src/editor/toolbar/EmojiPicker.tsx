/**
 * 表情选择器：网格展示内置表情，支持中文名与英文关键词搜索，点击即插入光标处。
 * 复用约定：shadcn Popover + 零尺寸固定锚点（与选区浮层同一套定位），Input 用于搜索。
 * 关键约束：弹层必须阻止默认焦点行为，否则编辑器失焦后选区塌陷、插入位置跑到文首；
 * 搜索词用 key 随会话重建，避免「关掉再打开还残留上次的查询」。
 */
import { useState, useSyncExternalStore } from 'react'
import { Input } from '@components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@components/ui/popover'
import { ScrollArea } from '@components/ui/scroll-area'
import { filterEmojis } from './emojiData'
import { closeEmojiPicker, getEmojiSession, subscribeEmoji } from './emojiStore'
import type { EmojiSession } from './emojiStore'
import type { JSX } from 'react'

interface EmojiPanelProps {
    session: EmojiSession
}

function EmojiPanel({ session }: EmojiPanelProps): JSX.Element {
    const [query, setQuery] = useState('')
    const items = filterEmojis(query)

    const insert = (char: string): void => {
        session.editor.chain().focus().insertContent(char).run()
        closeEmojiPicker()
    }

    return (
        <Popover
            open
            onOpenChange={(nextOpen): void => {
                if (!nextOpen) {
                    closeEmojiPicker()
                }
            }}
        >
            <PopoverAnchor asChild>
                <div className="pointer-events-none fixed h-0 w-0" style={{ left: session.left, top: session.top }} />
            </PopoverAnchor>
            <PopoverContent
                side="bottom"
                align="start"
                className="w-72 p-2"
                onMouseDown={(event): void => {
                    // 阻止焦点离开编辑器：否则选区塌陷，插入位置会跑到文首
                    event.preventDefault()
                }}
                onOpenAutoFocus={(event): void => {
                    event.preventDefault()
                }}
            >
                <Input
                    autoFocus
                    value={query}
                    placeholder="搜索表情（笑脸 / smile）"
                    className="h-7 text-sm"
                    onChange={(event): void => {
                        setQuery(event.target.value)
                    }}
                />
                <ScrollArea className="mt-2 max-h-56">
                    <div className="grid grid-cols-8 gap-1">
                        {items.map((item) => (
                            <button
                                key={item.char}
                                type="button"
                                title={item.name}
                                className="rounded p-1 text-lg leading-none hover:bg-accent"
                                onClick={(): void => {
                                    insert(item.char)
                                }}
                            >
                                {item.char}
                            </button>
                        ))}
                    </div>
                </ScrollArea>
                {items.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">没有匹配的表情</p>
                ) : null}
            </PopoverContent>
        </Popover>
    )
}

export function EmojiPicker(): JSX.Element | null {
    const session = useSyncExternalStore(subscribeEmoji, getEmojiSession, getEmojiSession)
    if (session === null) {
        return null
    }
    // key 随锚点变化重建面板：搜索词与滚动位置都回到初始态
    return <EmojiPanel key={`${String(session.left)}-${String(session.top)}`} session={session} />
}
