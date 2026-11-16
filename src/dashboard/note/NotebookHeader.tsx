/**
 * 笔记本折叠头：折叠箭头与文件夹图标叠在同一格，展开或悬停时显示箭头，收起且未悬停时显示文件夹。
 * 复用 @components/ui 的 CollapsibleTrigger（保留 Radix 注入的 aria-expanded / aria-controls）与 cn 合并条件类名。
 * 关键约束：可访问名由 formatNotebookLabel 拼装——内部图标与徽章对屏幕阅读器不可读，数量与标记只能写进文案；
 * 显隐一律由 :hover 决定，不掺入 focus-within，否则鼠标点完折叠按钮会让箭头常亮、文件夹再不出现。
 */
import { cn } from 'cn'
import { ChevronDown, Notebook, Pin } from 'lucide-react'
import { CollapsibleTrigger } from '@components/ui/collapsible'
import type { NotebookSummary } from '@shared/types/notebook'
import { formatNotebookLabel } from './utils'
import type { JSX } from 'react'

interface NotebookHeaderButtonProps {
    notebook: NotebookSummary
    isOpen: boolean
}

export function NotebookHeaderButton({ notebook, isOpen }: NotebookHeaderButtonProps): JSX.Element {
    return (
        <CollapsibleTrigger asChild>
            <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-full py-1.5 pl-2 text-left"
                aria-label={formatNotebookLabel(notebook)}
            >
                {/* 箭头与文件夹叠在同一格：展开或悬停时显示箭头，收起且未悬停时显示文件夹 */}
                <span className="grid size-4 shrink-0 place-items-center">
                    <ChevronDown
                        className={cn(
                            'col-start-1 row-start-1 size-4 text-muted-foreground transition-[transform,opacity]',
                            isOpen ? '' : '-rotate-90 opacity-0',
                            'group-hover/notebook:opacity-100',
                        )}
                    />
                    <Notebook
                        className={cn(
                            'col-start-1 row-start-1 size-4 text-muted-foreground transition-opacity',
                            isOpen ? 'opacity-0' : 'opacity-100',
                            'group-hover/notebook:opacity-0',
                        )}
                    />
                </span>
                <span className="min-w-0 truncate text-sm">{notebook.name}</span>
                {notebook.isPinned ? <Pin className="size-3 shrink-0 text-muted-foreground" /> : null}
                {notebook.isDefault ? (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground group-hover/notebook:hidden">
                        默认
                    </span>
                ) : null}
            </button>
        </CollapsibleTrigger>
    )
}
