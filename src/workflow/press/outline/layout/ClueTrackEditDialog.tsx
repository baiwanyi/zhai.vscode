/**
 * 伏笔编辑对话框：编辑伏笔名、类型、埋设章、回收章、触发者、状态与备注，并只读展示逾期预警。
 * 复用约定：骨架取 @webview/components/Dialog，字段取 @components/ui/field，输入取 ui/input / textarea / select；
 * 章节与人物等长列表取 @components/ui/combobox（顶部搜索 + 按角色/卷分组 + 限高滚动），选项来自 ChapterRefOption 与 CharacterCard；预警取 Alert，保存结果以 sonner 反馈。
 * 关键约束：编辑期只在本地草稿改，确认后一次性回传；调用方以伏笔 id 作 key，避免草稿串到上一次编辑的伏笔。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    Combobox,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxLabel,
    ComboboxList,
    ComboboxTrigger,
} from '@components/ui/combobox'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Textarea } from '@components/ui/textarea'
import { Alert } from '@webview/components/Alert'
import { Dialog } from '@webview/components/Dialog'
import type { CharacterCard, OutlineClue } from '../../types'
import type { ChapterRefOption, ClueWarning } from '../../utils'
import type { CSSProperties, JSX, RefObject } from 'react'
import { CHARACTER_ROLE_META, CHARACTER_ROLE_ORDER, CLUE_KIND_OPTIONS, CLUE_STATUS_OPTIONS } from '../../constants'
import { parseChapterRefValue, stripVolumeOrderPrefix } from '../../utils'

/** 章节引用下拉：空值用 none 表示未定，避免受控 Select 出现空串 */
const NO_REF = 'none'

/** 下拉回传字符串：none 还原为 null；解析失败回 undefined，由调用方保留原值 */
const toRef = (value: string): OutlineClue['plant'] | undefined =>
    value === NO_REF ? null : (parseChapterRefValue(value) ?? undefined)

/** 章节引用取值：受控 Select 的空值与「卷序-章序」互转 */
const chapterValue = (ref: OutlineClue['plant']): string =>
    ref === null ? NO_REF : `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`

/** 触发区外观：与 ui/input 同一套类名，保证表单里长下拉与短下拉对齐 */
const COMBOBOX_TRIGGER_CLASS =
    'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/** 覆盖 shadcn 自带的 no-scrollbar：长列表限高、横向不溢出且保留可见纵向滚动条 */
const COMBOBOX_LIST_CLASS =
    'mt-2.5 w-full min-w-0 [overflow-x:hidden] max-h-64 [scrollbar-width:auto]! [&::-webkit-scrollbar]:block! [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'

/** 浮层预估高度：搜索框 + 列表限高 16rem + 间距，用于判断触发区下方空间是否够向下展开 */
const COMBOBOX_PANEL_HEIGHT = 300

/** 下拉选项：value 为回传值，label 同时用于展示与搜索 */
interface SearchableOption {
    value: string
    label: string
}

/** 下拉分组：label 为空时不渲染组标题，用于「未定 / 未指定」置顶项 */
interface SearchableGroup {
    label: string
    options: SearchableOption[]
}

/** 人物选项：未指定置顶，其余按角色分组，组序取 CHARACTER_ROLE_ORDER */
function buildCharacterGroups(characters: readonly CharacterCard[]): SearchableGroup[] {
    const groups: SearchableGroup[] = [{ label: '', options: [{ value: NO_REF, label: '未指定' }] }]
    CHARACTER_ROLE_ORDER.forEach((role) => {
        const options = characters
            .filter((character) => character.role === role)
            .map((character) => ({ value: character.id, label: character.name }))
        if (options.length > 0) {
            groups.push({ label: CHARACTER_ROLE_META[role].label, options })
        }
    })
    return groups
}

/** 章节选项：未定置顶，其余按卷分组，组名取「第N卷」 */
function buildChapterGroups(refOptions: readonly ChapterRefOption[]): SearchableGroup[] {
    const groups: SearchableGroup[] = [{ label: '', options: [{ value: NO_REF, label: '未定' }] }]
    const byVolume = new Map<number, SearchableOption[]>()
    refOptions.forEach((option) => {
        const options = byVolume.get(option.ref.volumeOrder) ?? []
        options.push({ value: option.value, label: stripVolumeOrderPrefix(option.label).replace(/^·\s*/u, '') })
        byVolume.set(option.ref.volumeOrder, options)
    })
    const volumeOrders = [...byVolume.keys()].sort((a, b) => a - b)
    volumeOrders.forEach((volumeOrder) => {
        groups.push({ label: `第${String(volumeOrder)}卷`, options: byVolume.get(volumeOrder) ?? [] })
    })
    return groups
}

interface SearchableSelectProps {
    value: string
    groups: SearchableGroup[]
    ariaLabel: string
    placeholder: string
    emptyText: string
    /** Dialog 内容节点：fixed 浮层按它换算相对坐标 */
    dialogRef: RefObject<HTMLDivElement | null>
    onChange: (value: string) => void
}

interface SearchableOptionListProps {
    groups: SearchableGroup[]
    emptyText: string
}

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

/** 长列表下拉：面板 fixed 浮在触发区下方，不参与 Dialog 滚动区高度；顶部搜索、列表限高滚动 */
function SearchableSelect({
    value,
    groups,
    ariaLabel,
    placeholder,
    emptyText,
    dialogRef,
    onChange,
}: SearchableSelectProps): JSX.Element {
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
    const selectedLabel = groups.flatMap((group) => group.options).find((option) => option.value === value)?.label ?? ''

    /** 打开时重置搜索并按触发区与 Dialog 内容节点的相对位置算浮层坐标 */
    const handleOpen = (): void => {
        if (!isOpen) {
            setQuery('')
        }
        const triggerEl = triggerRef.current
        const dialogEl = dialogRef.current
        if (triggerEl !== null && dialogEl !== null) {
            const triggerRect = triggerEl.getBoundingClientRect()
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
            value={value}
            onValueChange={(next): void => {
                if (next !== null) {
                    onChange(next)
                    setQuery('')
                    setIsOpen(false)
                }
            }}
        >
            <div ref={containerRef} className="relative w-full">
                <ComboboxTrigger
                    ref={triggerRef}
                    className={COMBOBOX_TRIGGER_CLASS}
                    aria-label={ariaLabel}
                    aria-expanded={isOpen}
                    onClick={handleOpen}
                >
                    <span className="block min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
                </ComboboxTrigger>
                {isOpen ? (
                    <div
                        style={{ position: 'fixed', maxWidth: '22rem', ...panelStyle }}
                        className="z-50 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md whitespace-nowrap"
                    >
                        <ComboboxInput
                            aria-label={`搜索${ariaLabel}`}
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

interface ClueTrackEditDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    clue: OutlineClue
    characters: CharacterCard[]
    refOptions: ChapterRefOption[]
    /** 当前伏笔的预警：只读展示，不参与草稿 */
    warnings: ClueWarning[]
    onSave: (clue: OutlineClue) => void
}

/** 伏笔编辑：本地草稿与父级列表隔离，确认后一次性回传 */
export function ClueTrackEditDialog({
    isOpen,
    onOpenChange,
    clue,
    characters,
    refOptions,
    warnings,
    onSave,
}: ClueTrackEditDialogProps): JSX.Element {
    const [draft, setDraft] = useState<OutlineClue>(clue)
    const dialogContentRef = useRef<HTMLDivElement | null>(null)
    const clueWarnings = warnings.filter((warning) => warning.clue.id === clue.id)
    const characterGroups = useMemo(() => buildCharacterGroups(characters), [characters])
    const chapterGroups = useMemo(() => buildChapterGroups(refOptions), [refOptions])

    const patch = (changes: Partial<OutlineClue>): void => {
        setDraft((current) => ({ ...current, ...changes }))
    }

    const handleConfirm = (): void => {
        onSave(draft)
        toast.success('伏笔已保存')
        onOpenChange(false)
    }

    return (
        <Dialog size="full"
            open={isOpen}
            contentRef={dialogContentRef}
            title="编辑伏笔"
            description="记录埋设与回收的位置，状态由作者显式切换"
            onOpenChange={onOpenChange}
            onConfirm={handleConfirm}
        >
            {clueWarnings.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                    {clueWarnings.map((warning) => (
                        <Alert
                            key={`${warning.clue.id}-${warning.message}`}
                            title={warning.message}
                            variant={warning.severity === 'warning' ? 'destructive' : 'default'}
                        />
                    ))}
                </div>
            )}
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor="outline-clue-name">伏笔名</FieldLabel>
                    <Input
                        id="outline-clue-name"
                        value={draft.name}
                        placeholder="玉牌裂纹 / 无名信 / 旧照片"
                        onChange={(event): void => patch({ name: event.target.value })}
                    />
                </Field>
                <div className="grid grid-cols-3 gap-2.5">
                    <Field>
                        <FieldLabel>触发者</FieldLabel>
                        <SearchableSelect
                            value={draft.triggerId.length > 0 ? draft.triggerId : NO_REF}
                            groups={characterGroups}
                            ariaLabel="触发者"
                            placeholder="搜索人物…"
                            emptyText="没有匹配的人物"
                            dialogRef={dialogContentRef}
                            onChange={(value): void => patch({ triggerId: value === NO_REF ? '' : value })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>状态</FieldLabel>
                        <Select
                            value={draft.status}
                            onValueChange={(value): void => {
                                const next = CLUE_STATUS_OPTIONS.find((option) => option.value === value)
                                if (next !== undefined) {
                                    patch({ status: next.value })
                                }
                            }}
                        >
                            <SelectTrigger aria-label="伏笔状态" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {CLUE_STATUS_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <FieldLabel>类型</FieldLabel>
                        <Select
                            value={draft.kind}
                            onValueChange={(value): void => {
                                const next = CLUE_KIND_OPTIONS.find((option) => option.value === value)
                                if (next !== undefined) {
                                    patch({ kind: next.value })
                                }
                            }}
                        >
                            <SelectTrigger aria-label="伏笔类型" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {CLUE_KIND_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                    <Field>
                        <FieldLabel>埋设章</FieldLabel>
                        <SearchableSelect
                            value={chapterValue(draft.plant)}
                            groups={chapterGroups}
                            ariaLabel="埋设章"
                            placeholder="搜索章节…"
                            emptyText="没有匹配的章节"
                            dialogRef={dialogContentRef}
                            onChange={(value): void => {
                                const next = toRef(value)
                                if (next !== undefined) {
                                    patch({ plant: next })
                                }
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>回收章</FieldLabel>
                        <SearchableSelect
                            value={chapterValue(draft.payoff)}
                            groups={chapterGroups}
                            ariaLabel="回收章"
                            placeholder="搜索章节…"
                            emptyText="没有匹配的章节"
                            dialogRef={dialogContentRef}
                            onChange={(value): void => {
                                const next = toRef(value)
                                if (next !== undefined) {
                                    patch({ payoff: next })
                                }
                            }}
                        />
                    </Field>
                </div>
                <Field>
                    <FieldLabel htmlFor="outline-clue-note">备注</FieldLabel>
                    <Textarea
                        id="outline-clue-note"
                        rows={3}
                        value={draft.note}
                        placeholder="这条线在暗示什么、回收时读者该有什么反应"
                        onChange={(event): void => patch({ note: event.target.value })}
                    />
                </Field>
            </FieldGroup>
        </Dialog>
    )
}
