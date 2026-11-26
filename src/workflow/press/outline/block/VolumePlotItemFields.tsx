/**
 * 卷纲条目字段编辑块：主要情节与关键转折共用，默认折叠、标题后显示条目数；单条项组件同文件定义。
 * 复用约定：分组容器取 ui/card（CardHeader 放折叠触发器与添加按钮，CardContent 放说明与列表），
 * 折叠取 ui/collapsible，单条项取 ui/input-group（文本域 + block-start 序号与删除按钮），空列表取 blocks/StateEmpty；
 * 「添加」按钮放在 CollapsibleTrigger 之外，点它不会连带折叠。
 * 关键约束：条目多时列表自身限高滚动、不撑高弹窗；增删与改字一律按 id 定位条目，不复用相邻输入框。
 */
import { ChevronRight, ListTodo, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { FieldGroup } from '@components/ui/field'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupTextarea,
} from '@components/ui/input-group'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import type { EditablePlotItem } from '../utils/volumeEditDraft'
import type { JSX } from 'react'
import { createEditableItem } from '../utils/volumeEditDraft'

interface VolumePlotItemProps {
    item: EditablePlotItem
    index: number
    label: string
    placeholder: string
    onTextChange: (id: string, text: string) => void
    onRemove: (id: string) => void
}

function VolumePlotItem({ item, index, label, placeholder, onTextChange, onRemove }: VolumePlotItemProps): JSX.Element {
    return (
        <InputGroup className="has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupTextarea
                rows={2}
                value={item.text}
                className="py-1"
                aria-label={`${label}第 ${index + 1} 条`}
                placeholder={placeholder}
                onChange={(event): void => onTextChange(item.id, event.target.value)}
            />
            <InputGroupAddon align="block-start" className="pb-0">
                <InputGroupText>{`${label} ${index + 1}`}</InputGroupText>
                <InputGroupButton
                    size="icon-xs"
                    className="ml-auto hover:text-destructive"
                    aria-label={`删除${label}第 ${index + 1} 条`}
                    onClick={(): void => onRemove(item.id)}
                >
                    <Trash2 />
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    )
}

export interface VolumePlotItemFieldsProps {
    label: string
    hint: string
    addLabel: string
    placeholder: string
    items: readonly EditablePlotItem[]
    onChange: (items: EditablePlotItem[]) => void
}

export function VolumePlotItemFields({
    label,
    hint,
    addLabel,
    placeholder,
    items,
    onChange,
}: VolumePlotItemFieldsProps): JSX.Element {
    const handleTextChange = (id: string, text: string): void => {
        onChange(items.map((current) => (current.id === id ? { ...current, text } : current)))
    }

    const handleRemove = (id: string): void => {
        onChange(items.filter((current) => current.id !== id))
    }

    return (
        <Collapsible className="group/list px-1">
            <Card size="sm">
                <CollapsibleTrigger className="cursor-pointer" asChild>
                    <CardHeader>
                        <CardTitle>
                            <Button
                                variant="ghost"
                                className="min-w-0 justify-start gap-1 px-0 hover:bg-transparent dark:hover:bg-transparent aria-expanded:bg-transparent"
                            >
                                <span className="font-bold min-w-0 truncate">{label}</span>
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/list:rotate-90" />
                            </Button>
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
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent>
                        {items.length === 0 ? (
                            <StateEmpty
                                icon={ListTodo}
                                title="还没有条目"
                                description={`点「${addLabel}」逐条写。`}
                                className="py-6"
                            />
                        ) : (
                            <FieldGroup className="max-h-64 overflow-y-auto pr-1">
                                {items.map((item, index) => (
                                    <VolumePlotItem
                                        key={item.id}
                                        item={item}
                                        index={index}
                                        label={label}
                                        placeholder={placeholder}
                                        onTextChange={handleTextChange}
                                        onRemove={handleRemove}
                                    />
                                ))}
                            </FieldGroup>
                        )}
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    )
}
