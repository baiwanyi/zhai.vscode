/**
 * 卷纲条目列表编辑块：主要情节与关键转折共用，默认折叠、标题后显示条目数。
 * 复用约定：分组容器取 ui/card（CardHeader 放折叠触发器与添加按钮，CardContent 放说明与列表），
 * 折叠取 ui/collapsible，单条行取同目录 VolumePlotItemRow；「添加」按钮放在 CollapsibleTrigger 之外，点它不会连带折叠。
 * 关键约束：条目多时列表自身限高滚动、不撑高弹窗；增删与改字一律按 id 定位条目，不复用相邻输入框。
 */
import { ChevronRight, Plus } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { ItemGroup } from '@components/ui/item'
import { Button } from '@webview/components/Button'
import { VolumePlotItemRow } from './VolumePlotItemRow'
import type { EditablePlotItem } from '../utils/volumeEditDraft'
import type { JSX } from 'react'
import { createEditableItem } from '../utils/volumeEditDraft'

export interface VolumePlotItemListProps {
    label: string
    hint: string
    addLabel: string
    placeholder: string
    items: readonly EditablePlotItem[]
    onChange: (items: EditablePlotItem[]) => void
}

export function VolumePlotItemList({
    label,
    hint,
    addLabel,
    placeholder,
    items,
    onChange,
}: VolumePlotItemListProps): JSX.Element {
    const handleTextChange = (id: string, text: string): void => {
        onChange(items.map((current) => (current.id === id ? { ...current, text } : current)))
    }

    const handleRemove = (id: string): void => {
        onChange(items.filter((current) => current.id !== id))
    }

    return (
        <Collapsible className="group/list px-1">
            <Card size="sm">
                <CardHeader>
                    <CardTitle>
                        <CollapsibleTrigger asChild>
                            <Button
                                variant="ghost"
                                className="min-w-0 justify-start gap-1 px-0 hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
                            >
                                <span className="font-bold min-w-0 truncate">{label}</span>
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/list:rotate-90" />
                            </Button>
                        </CollapsibleTrigger>
                    </CardTitle>
                    <CardAction className="flex items-center gap-1.5">
                        <Badge variant="outline" className="tabular-nums">
                            {items.length} 条
                        </Badge>
                        <Button
                            variant="secondary"
                            size="icon-xs"
                            tooltip={addLabel}
                            onClick={(): void => onChange([...items, createEditableItem()])}
                        >
                            <Plus />
                        </Button>
                    </CardAction>
                    <CardDescription>{hint}</CardDescription>
                </CardHeader>
                <CollapsibleContent>
                    <CardContent className="flex flex-col gap-2">
                        {items.length === 0 ? (
                            <p className="text-muted-foreground">还没有条目，点「{addLabel}」逐条写。</p>
                        ) : (
                            <div className="max-h-48 overflow-y-auto pr-1">
                                <ItemGroup>
                                    {items.map((item, index) => (
                                        <VolumePlotItemRow
                                            key={item.id}
                                            item={item}
                                            index={index}
                                            label={label}
                                            placeholder={placeholder}
                                            onTextChange={handleTextChange}
                                            onRemove={handleRemove}
                                        />
                                    ))}
                                </ItemGroup>
                            </div>
                        )}
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    )
}
