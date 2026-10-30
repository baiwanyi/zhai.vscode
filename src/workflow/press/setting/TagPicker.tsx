/**
 * 标签选择器：触发区展示已选标签，点击整块区域弹出面板，按分组勾选候选标签或自建标签。
 * 复用约定：弹层取 @components/ui/popover（受控 + Anchor 定位，不用 Trigger 是为了让整块触发区可点，
 * 区内还有逐个删除标签的按钮；面板宽度取 anchor 宽度变量，与触发区同宽、左边缘对齐），
 * 分组切换取 ui/tabs 并竖排（分组有七到九组，横排会挤成两三行），标签按钮取 ui/button、
 * 已选标签取 ui/badge，自定义输入取 ui/input-group；分组数据由页面按目标读者从 settingOptions 取，
 * 标签悬停说明的气泡沿用 @webview/components/Tooltip 的 TOOLTIP_CLASS（固定暗底亮字，箭头随之同色）。
 * 关键约束：删除按钮必须阻止冒泡，否则删一个标签会顺带把面板弹开；回车提交须跳过中文输入法的组合态；
 * 达到上限时只禁用未选项与自定义输入，已选项仍可取消；切过受众后不属于当前分组的已选标签保留在触发区。
 */
import { CornerDownLeft, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@components/ui/input-group'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { Button } from '@webview/components/Button'
import { TOOLTIP_CLASS } from '@webview/components/Tooltip'
import type { TagGroup } from '../types'
import type { JSX, KeyboardEvent } from 'react'

/** 触发区外观：与 ui/input 同一套类名，标签换行时靠 min-h 与 py 自动增高 */
const TRIGGER_CLASS =
    'flex min-h-8 w-full min-w-0 cursor-pointer flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

/** 标签网格：等宽等列，窄面板按可用宽度自动减列 */
const TAG_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] content-start gap-1'

interface TagPickerProps {
    /** 候选项：按目标读者切换的标签分组，空表时面板只保留自定义输入 */
    groups: readonly TagGroup[]
    value: readonly string[]
    /** 未选任何标签时触发区的占位文案 */
    placeholder: string
    /** 标签上限：达到后不再接受新标签，已选标签仍可取消 */
    max: number
    onChange: (next: string[]) => void
}

export function TagPicker({ groups, value, placeholder, max, onChange }: TagPickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [activeLabel, setActiveLabel] = useState(groups[0]?.label ?? '')
    const [draft, setDraft] = useState('')
    // 触发区不是 Radix 的 Trigger，按下时面板是否已开只能自己记：开着就只让 Radix 关，不再重开
    const wasOpenOnPressRef = useRef(false)

    // 目标读者切换后整表换掉：当前分组已不存在时退回第一组，面板不会停在空白标签页
    const activeGroup = groups.find((group) => group.label === activeLabel) ?? groups[0]
    const selectedTags = new Set(value)
    const isEmpty = value.length === 0
    const isFull = value.length >= max
    const isDraftEmpty = draft.trim().length === 0
    // 满额后输入框改成提示上限，占位与可访问名共用一句
    const draftPlaceholder = isFull ? `已达 ${max} 项上限` : '添加自定义标签'

    const removeTag = (tag: string): void => {
        onChange(value.filter((item) => item !== tag))
    }

    const handleToggle = (tag: string): void => {
        if (selectedTags.has(tag)) {
            removeTag(tag)
            return
        }
        if (isFull) {
            return
        }
        onChange([...value, tag])
    }

    /** 回车与点确认同一出口：空格、重复与超限都直接丢弃，输入框随即清空 */
    const handleCommit = (): void => {
        const next = draft.trim()
        setDraft('')
        if (next.length === 0 || selectedTags.has(next) || isFull) {
            return
        }
        onChange([...value, next])
    }

    const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
            return
        }
        event.preventDefault()
        handleCommit()
    }

    /** 记下按下瞬间的面板状态：已经开着时这次点击只负责关闭，不再重新打开 */
    const handleTriggerPointerDown = (): void => {
        wasOpenOnPressRef.current = isOpen
    }

    /** 面板开着时点触发区属于「点外部」，关闭交给 Radix；这里按按下瞬间的状态决定是否重新打开 */
    const handleTriggerClick = (): void => {
        if (wasOpenOnPressRef.current) {
            wasOpenOnPressRef.current = false
            return
        }
        setIsOpen(true)
    }

    const handleTriggerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return
        }
        event.preventDefault()
        setIsOpen((previous) => !previous)
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverAnchor asChild>
                <div
                    tabIndex={0}
                    aria-label={isEmpty ? placeholder : `标签：${value.join('、')}，点击重新选择`}
                    aria-haspopup="dialog"
                    aria-expanded={isOpen}
                    className={TRIGGER_CLASS}
                    onPointerDown={handleTriggerPointerDown}
                    onClick={handleTriggerClick}
                    onKeyDown={handleTriggerKeyDown}
                >
                    {isEmpty ? <span className="text-muted-foreground">{placeholder}</span> : null}
                    {value.map((tag) => (
                        <TagChip key={tag} label={tag} onRemove={removeTag} />
                    ))}
                </div>
            </PopoverAnchor>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)]">
                <PopoverHeader>
                    <PopoverTitle className="flex items-center justify-between gap-2">
                        <span>标签选择</span>
                        <span className="font-normal text-muted-foreground text-xs tabular-nums">
                            {`已选 ${value.length} / ${max}`}
                        </span>
                    </PopoverTitle>
                </PopoverHeader>
                <InputGroup>
                    <InputGroupInput
                        value={draft}
                        placeholder={draftPlaceholder}
                        aria-label={draftPlaceholder}
                        disabled={isFull}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={handleDraftKeyDown}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="添加标签"
                            tooltip="添加标签"
                            disabled={isDraftEmpty || isFull}
                            onClick={handleCommit}
                        >
                            <CornerDownLeft />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
                <Tabs
                    orientation="vertical"
                    value={activeGroup?.label ?? ''}
                    onValueChange={setActiveLabel}
                    className="gap-2"
                >
                    <TabsList className="max-h-64 w-24 shrink-0 flex-col items-stretch justify-start overflow-y-auto">
                        {groups.map((group) => (
                            <TabsTrigger
                                key={group.label}
                                value={group.label}
                                className="h-7 w-full flex-none justify-start px-2 text-xs"
                            >
                                {group.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {groups.map((group) => (
                        <TabsContent
                            key={group.label}
                            value={group.label}
                            className="max-h-64 min-w-0 flex-1 overflow-y-auto"
                        >
                            <div className={TAG_GRID_CLASS}>
                                {group.options.map((option) => (
                                    <TagOptionButton
                                        key={option.value}
                                        label={option.value}
                                        hint={option.hint}
                                        isSelected={selectedTags.has(option.value)}
                                        isDisabled={isFull}
                                        onToggle={handleToggle}
                                    />
                                ))}
                            </div>
                        </TabsContent>
                    ))}
                </Tabs>
            </PopoverContent>
        </Popover>
    )
}

interface TagChipProps {
    label: string
    onRemove: (label: string) => void
}

/** 触发区里的已选标签：点叉移除，点其余区域冒泡给触发区打开面板 */
function TagChip({ label, onRemove }: TagChipProps): JSX.Element {
    return (
        <Badge variant="outline" className="gap-1 pr-1">
            <span className="font-light">{label}</span>
            <Button
                variant="ghost"
                size="icon-xs"
                className="size-4 shrink-0"
                aria-label={`移除 ${label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation()
                    onRemove(label)
                }}
            >
                <X className="size-3" aria-hidden="true" />
            </Button>
        </Badge>
    )
}

interface TagOptionButtonProps {
    label: string
    /** 悬停说明：给出时按钮外包一层 span 挂 Tooltip，说明不占面板宽度 */
    hint?: string
    isSelected: boolean
    /** 已达上限：未选项禁用，已选项仍可取消 */
    isDisabled: boolean
    onToggle: (label: string) => void
}

/** 面板内的候选标签：等宽按钮，选中取主色，未选描边 */
function TagOptionButton({ label, hint, isSelected, isDisabled, onToggle }: TagOptionButtonProps): JSX.Element {
    const button = (
        <Button
            variant={isSelected ? 'default' : 'outline'}
            size="sm"
            aria-pressed={isSelected}
            disabled={isDisabled && !isSelected}
            className="w-full"
            onClick={() => onToggle(label)}
        >
            {label}
        </Button>
    )
    if (hint === undefined) {
        return button
    }
    // 提示只能挂在包裹层上：直接包按钮会让 Tooltip 的 data-state 覆盖按钮自身的状态属性
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex w-full">{button}</span>
            </TooltipTrigger>
            <TooltipContent className={TOOLTIP_CLASS}>{hint}</TooltipContent>
        </Tooltip>
    )
}
