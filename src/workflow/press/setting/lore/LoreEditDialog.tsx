/**
 * 条目编辑弹窗：把名称、描述、设定图封面与关联人物收在一个弹窗里，编辑过程只改本地草稿。
 * 复用约定：弹层复用 ui/dialog，字段控件取 ui/field 与 input，描述字段取 components/AiTextareaField，
 * 封面三态取 components/CoverFigure，关联人物选择取 ui/popover，分类徽标取 constants 的 CHARACTER_ROLE_META。
 * 关键约束：草稿只在本次打开期间存在，调用方须以条目 id 或「新建」作为 key 重建组件，否则会带上上一条的输入；
 * 关闭或取消一律丢弃草稿；名称必填与同分类去重由调用方校验，本组件只负责把草稿抛出去；
 * 描述生成在本弹窗内发起、结果只写本地草稿，与出图互斥（任一进行中即禁用另一个按钮）；
 * 设定图由调用方落盘并回读，这里只读展示封面。
 */
import { cn } from 'cn'
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@components/ui/popover'
import { AiTextareaField } from '@webview/components/AiTextareaField'
import { Button } from '@webview/components/Button'
import { CoverFigure } from '@webview/components/CoverFigure'
import { useLoreDescriptionGenerate } from './useLoreDescriptionGenerate'
import type { CharacterCard, LoreEntry, LoreKind, ProjectSetting } from '../../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META, LORE_KIND_META } from '../../constants'
import { toSettingSnapshot } from '../../utils'

interface LoreEditDialogProps {
    kind: LoreKind
    /** 正在编辑的条目：null 表示新建，名称与描述从空白开始 */
    entry: LoreEntry | null
    characters: readonly CharacterCard[]
    /** 整份设定：作为条目描述的生成依据 */
    setting: ProjectSetting
    /** 同分类其它条目名：仅作参照，避免生成同义条目 */
    siblings: readonly string[]
    /** 当前封面地址：由调用方从磁盘回读，null 表示尚未设置 */
    coverUrl: string | null
    /** 是否正在生成设定图：按钮据此显示加载态 */
    isGeneratingCover: boolean
    /** 生成设定图：成功后由调用方更新封面并写回条目 */
    onGenerateCover: () => void
    /** 保存草稿：返回 false 表示校验未通过，弹窗保持打开 */
    onSubmit: (draft: LoreEntry) => boolean
    onCancel: () => void
}

/** 新建态的空白条目：id 为空串即「尚未落盘」，提交时由调用方创建并生成标识 */
function createBlankEntry(kind: LoreKind): LoreEntry {
    return { id: '', kind, name: '', description: '', memberIds: [], coverImageId: null }
}

export function LoreEditDialog({
    kind,
    entry,
    characters,
    setting,
    siblings,
    coverUrl,
    isGeneratingCover,
    onGenerateCover,
    onSubmit,
    onCancel,
}: LoreEditDialogProps): JSX.Element {
    const meta = LORE_KIND_META[kind]
    const [draft, setDraft] = useState<LoreEntry>(() => entry ?? createBlankEntry(kind))
    const { isGenerating: isGeneratingDescription, generate: generateDescription } = useLoreDescriptionGenerate()

    const handleChange = (patch: Partial<LoreEntry>): void => {
        setDraft((previous) => ({ ...previous, ...patch }))
    }

    /** 生成描述：名称是核心事实，缺名称先提示；结果只写本地草稿，保存时才落盘 */
    const handleGenerateDescription = async (): Promise<void> => {
        const name = draft.name.trim()
        if (name.length === 0) {
            toast.error('请先填写名称，AI 需要它作为生成的核心事实')
            return
        }
        const content = await generateDescription({
            ...toSettingSnapshot(setting),
            kind,
            name,
            description: draft.description,
            siblings: [...siblings],
            members: characters
                .filter((character) => draft.memberIds.includes(character.id))
                .map((character) => character.name),
        })
        if (content !== null) {
            setDraft((previous) => ({ ...previous, description: content }))
        }
    }

    const handleSave = (): void => {
        if (onSubmit(draft)) {
            onCancel()
        }
    }

    return (
        <Dialog
            open
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onCancel()
                }
            }}
        >
            <DialogContent className="flex flex-col gap-3 sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="text-lg">
                        {entry === null
                            ? `新建${meta.label}`
                            : `编辑${meta.label} · ${draft.name.length > 0 ? draft.name : '未命名'}`}
                    </DialogTitle>
                    <DialogDescription>名称与描述会写入 {meta.label}.md，同一分类内名称不可重复。</DialogDescription>
                </DialogHeader>
                <LoreEditPanel
                    kind={kind}
                    draft={draft}
                    characters={characters}
                    coverUrl={coverUrl}
                    isGeneratingCover={isGeneratingCover}
                    isGeneratingDescription={isGeneratingDescription}
                    onGenerateCover={onGenerateCover}
                    onGenerateDescription={() => {
                        void handleGenerateDescription()
                    }}
                    onChange={handleChange}
                />
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        取消
                    </Button>
                    <Button onClick={handleSave}>保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface LoreEditPanelProps {
    kind: LoreKind
    draft: LoreEntry
    characters: readonly CharacterCard[]
    coverUrl: string | null
    isGeneratingCover: boolean
    /** 是否正在生成描述：与出图互斥，避免两类请求并发 */
    isGeneratingDescription: boolean
    onGenerateCover: () => void
    onGenerateDescription: () => void
    onChange: (patch: Partial<LoreEntry>) => void
}

/** 表单主体：左列封面与生成入口、右列名称与描述，势力额外带关联人物 */
function LoreEditPanel({
    kind,
    draft,
    characters,
    coverUrl,
    isGeneratingCover,
    isGeneratingDescription,
    onGenerateCover,
    onGenerateDescription,
    onChange,
}: LoreEditPanelProps): JSX.Element {
    return (
        <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] items-start gap-3">
            <div className="flex flex-col gap-2">
                <CoverFigure
                    src={coverUrl}
                    isLoading={false}
                    alt={`${draft.name.length > 0 ? draft.name : '未命名'} 的设定图`}
                    emptyTitle="还没有设定图"
                    emptyDescription="按名称与描述生成一张，或去生图页统一生成"
                />
                <Button
                    variant="outline"
                    size="sm"
                    isLoading={isGeneratingCover}
                    disabled={isGeneratingDescription}
                    onClick={onGenerateCover}
                >
                    <Sparkles />
                    {coverUrl === null ? '生成设定图' : '重新生成'}
                </Button>
            </div>
            <FieldGroup className="grid grid-cols-1 gap-3">
                <Field>
                    <FieldLabel htmlFor="lore-name">名称</FieldLabel>
                    <Input
                        id="lore-name"
                        value={draft.name}
                        placeholder="如「青云宗」「后山禁地」「断魂剑」"
                        className="h-7"
                        onChange={(event) => onChange({ name: event.target.value })}
                    />
                </Field>
                <AiTextareaField
                    id="lore-description"
                    label="描述"
                    value={draft.description}
                    placeholder="它是什么、有什么来历、在故事里起什么作用"
                    isGenerating={isGeneratingDescription}
                    isDisabled={isGeneratingDescription || isGeneratingCover}
                    description="支持多段落，保存后写进同名文档的条目正文"
                    generateLabel={`按名称与已填设定生成${LORE_KIND_META[kind].label}描述`}
                    onChange={(value) => onChange({ description: value })}
                    onGenerate={onGenerateDescription}
                />
                {kind === 'faction' ? (
                    <Field>
                        <FieldLabel>关联人物</FieldLabel>
                        <LoreMemberPicker
                            characters={characters}
                            value={draft.memberIds}
                            onChange={(memberIds) => onChange({ memberIds })}
                        />
                        <FieldDescription>只做索引用，删除人物卡时会自动解除关联</FieldDescription>
                    </Field>
                ) : null}
            </FieldGroup>
        </div>
    )
}

interface LoreMemberPickerProps {
    characters: readonly CharacterCard[]
    value: string[]
    onChange: (next: string[]) => void
}

/** 关联人物选择：触发区展示已选人物，面板内可搜索与勾选，候选为空时给出建卡指引 */
function LoreMemberPicker({ characters, value, onChange }: LoreMemberPickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [query, setQuery] = useState('')
    const selected = characters.filter((character) => value.includes(character.id))
    const keyword = query.trim().toLowerCase()
    const visible = characters.filter((character) =>
        keyword.length === 0
            ? true
            : [character.name, character.alias, character.identity].some((field) =>
                  field.toLowerCase().includes(keyword),
              ),
    )

    const toggle = (id: string): void => {
        onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverAnchor asChild>
                <div
                    role="button"
                    tabIndex={0}
                    aria-label={
                        selected.length > 0
                            ? `关联人物：${selected.map((character) => character.name).join('、')}，点击重新选择`
                            : '选择关联人物'
                    }
                    aria-haspopup="dialog"
                    aria-expanded={isOpen}
                    className="flex min-h-7 cursor-pointer flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => setIsOpen(true)}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') {
                            return
                        }
                        event.preventDefault()
                        setIsOpen((previous) => !previous)
                    }}
                >
                    {selected.length === 0 ? <span className="text-muted-foreground">选择关联人物（可选）</span> : null}
                    {selected.map((character) => (
                        <Badge key={character.id} variant="outline" className="gap-1 pr-1">
                            {character.name}
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-4 shrink-0"
                                aria-label={`移除 ${character.name}`}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onChange(value.filter((item) => item !== character.id))
                                }}
                            >
                                <X className="size-3" aria-hidden="true" />
                            </Button>
                        </Badge>
                    ))}
                </div>
            </PopoverAnchor>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)]">
                <PopoverHeader>
                    <PopoverTitle>关联人物</PopoverTitle>
                </PopoverHeader>
                <Input
                    value={query}
                    placeholder="搜索姓名、昵称或身份"
                    aria-label="搜索人物"
                    className="h-7"
                    onChange={(event) => setQuery(event.target.value)}
                />
                <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                    {visible.length === 0 ? (
                        <p className="px-1 py-2 text-muted-foreground text-xs">
                            {characters.length === 0 ? '还没有人物卡，先去角色页建卡' : '没有匹配的人物'}
                        </p>
                    ) : (
                        visible.map((character) => {
                            const isSelected = value.includes(character.id)
                            const roleMeta = CHARACTER_ROLE_META[character.role]
                            return (
                                <Button
                                    key={character.id}
                                    variant={isSelected ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="w-full justify-start gap-1.5"
                                    aria-pressed={isSelected}
                                    onClick={() => toggle(character.id)}
                                >
                                    <span className="truncate">{character.name}</span>
                                    <Badge className={cn('ml-auto shrink-0', roleMeta.className)}>
                                        {roleMeta.label}
                                    </Badge>
                                </Button>
                            )
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
