/**
 * 回收站条目：一行呈现笔记标题、原所属笔记本与删除时间，右侧提供恢复与彻底删除。
 * 复用 @components/ui 的 item 条目语义与 @shared/utils/format 的相对时间；图标入口取 @webview/components/Button。
 * 关键约束：彻底删除不可恢复，二次确认由页面统一弹出，本组件只上抛意图；
 * 操作按钮固定在行尾并常显，不做悬停显隐——回收站是低频页面，常显更易发现。
 */
import { FileText, RotateCcw, Trash2 } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@components/ui/item'
import type { TrashItem } from '@shared/types/trash'
import { formatRelativeTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 空标题兜底：与笔记列表同口径，空标题既不便于辨认，也会让两个按钮的可访问名残缺 */
const UNTITLED_NOTE_TITLE = '未命名笔记'

interface TrashItemRowProps {
    item: TrashItem
    isBusy: boolean
    onRestore: () => void
    onPurge: () => void
}

export function TrashItemRow({ item, isBusy, onRestore, onPurge }: TrashItemRowProps): JSX.Element {
    const title = item.title.trim() === '' ? UNTITLED_NOTE_TITLE : item.title
    /** 时间为空串（字段损坏或非法时间）时不保留悬空的分隔点 */
    const deletedAt = formatRelativeTime(item.deletedAt)
    const subtitle = deletedAt === '' ? `原在「${item.notebookName}」` : `原在「${item.notebookName}」· ${deletedAt}`

    return (
        <Item size="sm" className="rounded-full py-1.5 hover:bg-muted/60">
            <ItemMedia variant="icon">
                <FileText className="size-4" />
            </ItemMedia>
            <ItemContent className="min-w-0">
                <ItemTitle className="truncate">{title}</ItemTitle>
                <ItemDescription className="truncate text-xs">{subtitle}</ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`恢复 ${title}`}
                    tooltip="恢复"
                    disabled={isBusy}
                    onClick={onRestore}
                >
                    <RotateCcw />
                </Button>
                <Button
                    variant="destructive"
                    size="icon-xs"
                    aria-label={`彻底删除 ${title}`}
                    tooltip="彻底删除"
                    disabled={isBusy}
                    onClick={onPurge}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
}
