/**
 * 作品详情页底部操作栏：左端「添加章节」直达按钮，右端省略号浮层承载素材抽取、摘要回填与删除作品。
 * 复用 @components/ui 的 dropdown-menu、spinner 与 @webview/components/Button；动作经回调上抛，自身不持有状态。
 * 关键约束：添加章节的落点由页面决定（展开卷 → 该卷，否则最后一个卷，无卷时自动建默认卷），本组件只负责触发；
 * 菜单项须置于 DropdownMenuGroup 内，破坏性动作单独分组并使用 destructive 变体；
 * 详情未就绪时禁用素材抽取与摘要回填，抽取、回填与删除各自按自身进行中态禁用，互不阻塞。
 */
import { Ellipsis, Plus, ScrollText, Sparkles, Trash2 } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface PressProjectFooterActionsProps {
    isAnalyzing: boolean
    /** 摘要回填中：禁用回填入口，避免重复写同一批章节 */
    isMergingSummary: boolean
    /** 章节新建中：禁用添加章节，避免连续写入同一卷 */
    isCreatingChapter: boolean
    isDeletingProject: boolean
    /** 详情数据是否就绪：未就绪时禁用素材抽取与摘要回填 */
    isReady: boolean
    onAddChapter: () => void
    onAnalyze: () => void
    onMergeSummary: () => void
    onDelete: () => void
}

export function PressProjectFooterActions({
    isAnalyzing,
    isMergingSummary,
    isCreatingChapter,
    isDeletingProject,
    isReady,
    onAddChapter,
    onAnalyze,
    onMergeSummary,
    onDelete,
}: PressProjectFooterActionsProps): JSX.Element {
    return (
        <div className="flex flex-1 items-center justify-between">
            <Button
                size="icon"
                variant="outline"
                tooltip="添加章节"
                aria-label="添加章节"
                disabled={isCreatingChapter}
                onClick={onAddChapter}
            >
                <Plus />
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" tooltip="更多操作" aria-label="更多操作">
                        <Ellipsis />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuGroup>
                        <DropdownMenuItem disabled={isAnalyzing || !isReady} onSelect={onAnalyze}>
                            {isAnalyzing ? <Spinner /> : <Sparkles />}
                            {isAnalyzing ? '正在抽取…' : '素材抽取'}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isMergingSummary || !isReady} onSelect={onMergeSummary}>
                            {isMergingSummary ? <Spinner /> : <ScrollText />}
                            {isMergingSummary ? '正在回填…' : '回填章节摘要'}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem variant="destructive" disabled={isDeletingProject} onSelect={onDelete}>
                            <Trash2 />
                            删除作品
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
