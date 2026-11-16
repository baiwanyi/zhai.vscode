/**
 * 「添加上下文」根列表：四类内容入口加上规则入口，是选择器的默认视图。
 * 复用约定：行取 @webview/components/Button，视图联合类型取 ../constants，规则概览由调用方按已挂数量传入。
 * 关键约束：本视图渲染在 Popover 内，点击只切换视图、不关闭浮层；
 * 根视图没有返回入口，返回按钮由选择器的标题栏按当前视图决定。
 */
import { FileText, Library, Newspaper, Package, PencilRuler } from 'lucide-react'
import { Button } from '@webview/components/Button'
import type { AiContextPickerView } from '../constants'
import type { JSX } from 'react'

interface AiChatContextRootListProps {
    /** 选定视图：由选择器自己完成切换 */
    onSelect: (view: AiContextPickerView) => void
    /** 已挂规则数：规则行右侧给出概览，让用户知道有没有挂过约束 */
    selectedRuleCount: number
}

interface RootRowProps {
    label: string
    icon: JSX.Element
    tail?: string
    onClick: () => void
}

/** 根列表行：图标 + 名称 + 可选右侧说明，整行可点 */
function RootRow({ label, icon, tail, onClick }: RootRowProps): JSX.Element {
    return (
        <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-1.5 px-1.5 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent"
            onClick={onClick}
        >
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {tail === undefined ? null : <span className="shrink-0 text-xs text-muted-foreground">{tail}</span>}
        </Button>
    )
}

export function AiChatContextRootList({ onSelect, selectedRuleCount }: AiChatContextRootListProps): JSX.Element {
    return (
        <div className="max-h-72 overflow-y-auto overscroll-contain">
            <RootRow
                label="选择笔记本"
                icon={<Library className="size-3.5 shrink-0 text-muted-foreground" />}
                onClick={() => onSelect({ mode: 'source', scope: 'notebook' })}
            />
            <RootRow
                label="选择笔记"
                icon={<FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                onClick={() => onSelect({ mode: 'items', target: { kind: 'note' } })}
            />
            <RootRow
                label="选择文章"
                icon={<Newspaper className="size-3.5 shrink-0 text-muted-foreground" />}
                onClick={() => onSelect({ mode: 'items', target: { kind: 'article' } })}
            />
            <RootRow
                label="选择作品"
                icon={<Package className="size-3.5 shrink-0 text-muted-foreground" />}
                onClick={() => onSelect({ mode: 'source', scope: 'project' })}
            />
            <RootRow
                label="规则"
                icon={<PencilRuler className="size-3.5 shrink-0 text-muted-foreground" />}
                tail={selectedRuleCount > 0 ? `已挂 ${String(selectedRuleCount)}` : undefined}
                onClick={() => onSelect({ mode: 'rules' })}
            />
        </div>
    )
}
