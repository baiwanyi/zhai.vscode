/**
 * AI 对话参考资料菜单：顶部工具行右侧的「参考」按钮，两项都由 {存储根}/reference 语料驱动。
 * 复用 @components/ui 的 DropdownMenu 与 @webview/components/Button。
 * 关键约束：语料由用户直接增删改文件，插件不写语料；两个入口都不占用工具行的第三个按钮 ——
 * 检索走宿主 ai/reference/search，打开目录走 ai/reference/openDir（目录不存在时由宿主创建）。
 */
import { AtSign, BookOpen, FolderOpen, Search } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 参考菜单动作：检索语料 / 打开语料目录 */
export type AiReferenceAction = 'search' | 'openDir'

interface AiChatReferenceMenuProps {
    disabled: boolean
    onSelect: (action: AiReferenceAction) => void
    /** 打开提及检索：引用笔记 / 章节 */
    onMention: () => void
}

export function AiChatReferenceMenu({ disabled, onSelect, onMention }: AiChatReferenceMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-muted-foreground"
                    title="参考资料"
                    aria-label="参考资料"
                    disabled={disabled}
                >
                    <BookOpen />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>参考资料</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onSelect('search')} className="gap-2">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">检索参考资料</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onMention} className="gap-2">
                    <AtSign className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">引用笔记 / 章节</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSelect('openDir')} className="gap-2">
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">打开语料目录</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
