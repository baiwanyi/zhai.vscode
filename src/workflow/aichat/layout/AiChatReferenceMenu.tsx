/**
 * 参考资料菜单：工具行右侧入口，收纳检索语料、引用笔记 / 章节与打开语料目录三项。
 * 复用约定：外壳取 @components/ui 的 DropdownMenu，触发器取 @webview/components/Button，
 * 动作联合类型取自 ../constants，与页面共用同一份定义。
 * 关键约束：工具行严格保持两个按钮——添加上下文与参考资料；本菜单不承载写作命令与设置入口，
 * 只上抛动作标识与「打开提及检索」意图，检索、目录打开与上下文写入的实现都在页面侧。
 */
import { AtSign, FolderOpen, LibraryBig, Search } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { AiReferenceAction } from '../constants'
import type { JSX } from 'react'

interface AiChatReferenceMenuProps {
    disabled: boolean
    onReference: (action: AiReferenceAction) => void
    /** 打开提及检索：引用笔记 / 章节 */
    onMention: () => void
}

export function AiChatReferenceMenu({ disabled, onReference, onMention }: AiChatReferenceMenuProps): JSX.Element {
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
                    <LibraryBig />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>参考资料</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onReference('search')} className="gap-2">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">检索参考资料</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onMention} className="gap-2">
                    <AtSign className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">引用笔记 / 章节</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onReference('openDir')} className="gap-2">
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">打开语料目录</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
