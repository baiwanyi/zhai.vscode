/**
 * 多选搜索组合框：长列表按分组渲染并支持搜索，选中项以数组回传，可连续勾选。
 * 复用约定：结构取 @components/ui/combobox，选项及其分组由调用方给定；本组件只按 label 过滤，
 * 不持有业务选项或哨兵值，触发区文案由选中项的 label 拼出。
 * 关键约束：面板用 fixed 浮层避免撑开滚动区，按可选 dialogRef 换算坐标、缺省按视口定位，并依可用空间决定展开方向；
 * 选中后清空搜索词但保留面板以便连续勾选，点击面板外部收起，空分组展示调用方给定的空态文案。
 */
import { useEffect, useRef, useState } from 'react'
import {
    Combobox,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxLabel,
    ComboboxList,
    ComboboxTrigger,
} from '@components/ui/combobox'
import type { CSSProperties, JSX, RefObject } from 'react'

/** 下拉选项：value 为回传值，label 同时用于展示与搜索 */
export interface SearchableOption {
    value: string
    label: string
}

/** 下拉分组：label 为空时不渲染组标题，用于「未定 / 未指定」置顶项 */
export interface SearchableGroup {
    label: string
    options: SearchableOption[]
}

export interface SearchComboboxProps {
    /** 无障碍标签，用于触发按钮与搜索框 */
    label: string
    value: readonly string[]
    groups: readonly SearchableGroup[]
    placeholder: string
    emptyText: string
    /** 可选定位容器：提供时 fixed 浮层按它换算相对坐标，未提供时按视口定位 */
    dialogRef?: RefObject<HTMLDivElement | null>
    onChange: (values: string[]) => void
}

interface SearchableOptionListProps {
    groups: readonly SearchableGroup[]
    emptyText: string
}

/** 触发区外观：与 ui/input 同一套类名，保证长下拉与短下拉对齐 */
const COMBOBOX_TRIGGER_CLASS =
    'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/** 覆盖 shadcn 自带的 no-scrollbar：长列表限高、横向不溢出且保留可见纵向滚动条 */
const COMBOBOX_LIST_CLASS =
    'mt-2.5 w-full min-w-0 [overflow-x:hidden] max-h-64 [scrollbar-width:auto]! [&::-webkit-scrollbar]:block! [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'

/** 浮层预估高度：搜索框 + 列表限高 16rem + 间距，用于判断触发区下方空间是否够向下展开 */
const COMBOBOX_PANEL_HEIGHT = 300

/** 长列表内容：空态提示与按分组渲染的选项，选项文本单行省略 */
function SearchableOptionList({ groups, emptyText }: SearchableOptionListProps): JSX.Element {
    return (
        <ComboboxList className={COMBOBOX_LIST_CLASS}>
            {groups.length === 0 ? (
                <div className="px-2 py-2 text-center text-sm text-muted-foreground">{emptyText}</div>
            ) : (
                groups.map((group) => (
                    <ComboboxGroup key={group.label || 'ungrouped'} className="w-full min-w-0">
                        {group.label.length > 0 ? (
                            <ComboboxLabel className="px-1.5 py-2 block truncate border-t mt-2">
                                {group.label}
                            </ComboboxLabel>
                        ) : null}
                        {group.options.map((option) => (
                            <ComboboxItem
                                key={option.value}
                                value={option.value}
                                className="flex-nowrap overflow-hidden"
                            >
                                <span className="block min-w-0 flex-1 truncate">{option.label}</span>
                            </ComboboxItem>
                        ))}
                    </ComboboxGroup>
                ))
            )}
        </ComboboxList>
    )
}

/** 多选搜索组合框：面板浮在触发区下方，不参与 Dialog 滚动区高度；顶部搜索、列表限高滚动 */
export function SearchCombobox({
    label,
    value,
    groups,
    placeholder,
    emptyText,
    dialogRef,
    onChange,
}: SearchComboboxProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
    const containerRef = useRef<HTMLDivElement | null>(null)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const normalizedQuery = query.trim().toLowerCase()
    const visibleGroups = groups
        .map((group) => ({
            ...group,
            options: group.options.filter((option) => option.label.toLowerCase().includes(normalizedQuery)),
        }))
        .filter((group) => group.options.length > 0)
    const options = groups.flatMap((group) => group.options)
    const selectedLabels = value
        .map((selected) => options.find((option) => option.value === selected)?.label)
        .filter((optionLabel): optionLabel is string => optionLabel !== undefined)

    /** 打开时重置搜索并按触发区与定位容器的相对位置算浮层坐标；无容器时按视口定位 */
    const handleOpen = (): void => {
        if (!isOpen) {
            setQuery('')
        }
        const triggerEl = triggerRef.current
        if (triggerEl === null) {
            setIsOpen(true)
            return
        }
        const triggerRect = triggerEl.getBoundingClientRect()
        const dialogEl = dialogRef?.current
        if (dialogEl !== null && dialogEl !== undefined) {
            const dialogRect = dialogEl.getBoundingClientRect()
            const spaceAbove = triggerRect.top - dialogRect.top
            const spaceBelow = dialogRect.bottom - triggerRect.bottom
            const shouldFlip = spaceBelow < COMBOBOX_PANEL_HEIGHT && spaceAbove > spaceBelow
            setPanelStyle({
                top: shouldFlip ? spaceAbove - COMBOBOX_PANEL_HEIGHT - 4 : triggerRect.bottom - dialogRect.top + 4,
                left: triggerRect.left - dialogRect.left,
                width: triggerRect.width,
                maxHeight: Math.max((shouldFlip ? spaceAbove : spaceBelow) - 8, 200),
            })
        } else {
            const spaceBelow = window.innerHeight - triggerRect.bottom
            const shouldFlip = spaceBelow < COMBOBOX_PANEL_HEIGHT && triggerRect.top > spaceBelow
            setPanelStyle({
                top: shouldFlip ? triggerRect.top - COMBOBOX_PANEL_HEIGHT - 4 : triggerRect.bottom + 4,
                left: triggerRect.left,
                width: triggerRect.width,
                maxHeight: Math.max((shouldFlip ? triggerRect.top : spaceBelow) - 8, 200),
            })
        }
        setIsOpen(true)
    }

    // 点击面板外部时收起，避免切换字段后上一个列表仍展开
    useEffect((): (() => void) | undefined => {
        if (!isOpen) {
            return undefined
        }
        const handlePointerDown = (event: PointerEvent): void => {
            if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('pointerdown', handlePointerDown)
        return (): void => document.removeEventListener('pointerdown', handlePointerDown)
    }, [isOpen])

    return (
        <Combobox
            inline
            open
            multiple
            value={value}
            onValueChange={(next): void => {
                onChange(next)
                setQuery('')
            }}
        >
            <div ref={containerRef} className="relative w-full">
                <ComboboxTrigger
                    ref={triggerRef}
                    className={COMBOBOX_TRIGGER_CLASS}
                    aria-label={label}
                    aria-expanded={isOpen}
                    onClick={handleOpen}
                >
                    <span className="block min-w-0 flex-1 truncate text-left">{selectedLabels.join('、')}</span>
                </ComboboxTrigger>
                {isOpen ? (
                    <div
                        style={{ position: 'fixed', maxWidth: '22rem', ...panelStyle }}
                        className="z-50 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md whitespace-nowrap"
                    >
                        <ComboboxInput
                            aria-label={`搜索${label}`}
                            placeholder={placeholder}
                            className="w-full"
                            autoFocus
                            onChange={(event): void => setQuery(event.target.value)}
                        />
                        <SearchableOptionList groups={visibleGroups} emptyText={emptyText} />
                    </div>
                ) : null}
            </div>
        </Combobox>
    )
}
