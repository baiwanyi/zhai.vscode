/**
 * 卷纲条目行：单条情节 / 转折的文本域与删除按钮，接收带稳定 id 的编辑态条目。
 * 复用约定：行容器取 ui/item，输入取 ui/textarea，删除按钮取 components/Button；
 * 序号与无障碍文案由 label 和 index 推导，调用方只给基于 id 的不可变更新回调。
 * 关键约束：onTextChange / onRemove 一律按 id 定位条目，不用数组下标——增删时相邻输入框不能被复用。
 */
import { Trash2 } from 'lucide-react'
import { Item, ItemActions, ItemContent } from '@components/ui/item'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import type { EditablePlotItem } from '../utils/volumeEditDraft'
import type { JSX } from 'react'

interface VolumePlotItemRowProps {
    item: EditablePlotItem
    index: number
    label: string
    placeholder: string
    onTextChange: (id: string, text: string) => void
    onRemove: (id: string) => void
}

export function VolumePlotItemRow({
    item,
    index,
    label,
    placeholder,
    onTextChange,
    onRemove,
}: VolumePlotItemRowProps): JSX.Element {
    return (
        <Item>
            <ItemContent>
                <Textarea
                    rows={2}
                    value={item.text}
                    aria-label={`${label}第 ${index + 1} 条`}
                    placeholder={placeholder}
                    onChange={(event): void => onTextChange(item.id, event.target.value)}
                />
            </ItemContent>
            <ItemActions>
                <Button
                    variant="ghost"
                    size="icon"
                    className="hover:text-destructive"
                    aria-label={`删除${label}第 ${index + 1} 条`}
                    onClick={(): void => onRemove(item.id)}
                >
                    <Trash2 />
                </Button>
            </ItemActions>
        </Item>
    )
}
