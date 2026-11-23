/**
 * 大纲功能模块面板：全书纲、结构纲、人物纲、设定纲与节奏情绪五类，各自独立编辑。
 * 复用约定：字段行复用 ui/input 与 ui/textarea，枚举档位复用 ui/select，联动人物卡复用 ui/dropdown-menu；
 * 卡片外壳取 ui/card，按钮取 components/Button 的 ghost / outline 两级，提示文案只取语义令牌。
 * 关键约束：每个面板只回传自己那一段的补丁，页面据此只落盘对应段落，互不覆盖；
 * 人物纲的「关联」与节奏行的章序是跨模块引用键，改错会让回填与线索对不上，因此只用下拉与数字选择；
 * 删除与排序都返回新数组，不原地修改传入的计划对象。
 */
import { Plus, Trash2, UserPlus } from 'lucide-react'
import { Card, CardContent } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Slider } from '@components/ui/slider'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import type {
    CharacterCard,
    OutlineAct,
    OutlineBook,
    OutlineChapter,
    OutlineCharacterLine,
    OutlinePacingEntry,
    OutlineSettingNote,
} from '../../types'
import type { JSX, ReactNode } from 'react'
import { PACING_KIND_OPTIONS, PACING_KIND_ORDER, PACING_META, TENSION_LABELS } from '../../constants'
import { createAct, createCharacterLine, createPacingEntry, createSettingNote } from '../../utils'

/** 单行字段：标签在上、输入在下，整块留出可点击的空白 */
function OutlineTextField({
    id,
    label,
    value,
    placeholder,
    onChange,
}: {
    id: string
    label: string
    value: string
    placeholder?: string
    onChange: (value: string) => void
}): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-muted-foreground">
                {label}
            </label>
            <Input
                id={id}
                value={value}
                placeholder={placeholder}
                className="h-7"
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    )
}

/** 多行字段：用于梗概、冲突与事件这类需要几句话的字段 */
function OutlineTextArea({
    id,
    label,
    value,
    placeholder,
    onChange,
}: {
    id: string
    label: string
    value: string
    placeholder?: string
    onChange: (value: string) => void
}): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-muted-foreground">
                {label}
            </label>
            <Textarea
                id={id}
                value={value}
                placeholder={placeholder}
                className="min-h-16"
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    )
}

/** 面板外壳：标题 + 说明 + 内容，保持各模块页面的视觉一致 */
function PanelShell({
    title,
    description,
    action,
    children,
}: {
    title: string
    description: string
    action?: JSX.Element
    children: ReactNode
}): JSX.Element {
    return (
        <div className="flex flex-col gap-3 p-3">
            <header className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h2 className="font-heading font-semibold">{title}</h2>
                    <p className="text-muted-foreground">{description}</p>
                </div>
                {action}
            </header>
            {children}
        </div>
    )
}

interface BookOutlinePanelProps {
    book: OutlineBook
    onChange: (patch: Partial<OutlineBook>) => void
}

/** 全书纲：一页纸故事核，防止写偏 */
export function BookOutlinePanel({ book, onChange }: BookOutlinePanelProps): JSX.Element {
    return (
        <PanelShell title="全书纲" description="一页纸故事核：主角是谁、他想要什么、谁在阻碍、失败代价与最终选择">
            <OutlineTextArea
                id="outline-book-logline"
                label="一句话梗概"
                value={book.logline}
                placeholder="主角为了____，必须____，但____，最终他选择____。"
                onChange={(logline) => onChange({ logline })}
            />
            <OutlineTextArea
                id="outline-book-conflict"
                label="核心冲突"
                value={book.conflict}
                placeholder="谁与谁、围绕什么正面相撞"
                onChange={(conflict) => onChange({ conflict })}
            />
            <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                <OutlineTextField
                    id="outline-book-theme"
                    label="主题"
                    value={book.theme}
                    placeholder="通过____事件，探讨____"
                    onChange={(theme) => onChange({ theme })}
                />
                <OutlineTextField
                    id="outline-book-ending"
                    label="结局方向"
                    value={book.ending}
                    placeholder="HE / BE / 开放 / 真相"
                    onChange={(ending) => onChange({ ending })}
                />
            </div>
            <OutlineTextArea
                id="outline-book-arc"
                label="主角弧光"
                value={book.arc}
                placeholder="从____到____，中间必须付出什么代价"
                onChange={(arc) => onChange({ arc })}
            />
        </PanelShell>
    )
}

interface StructurePanelProps {
    acts: OutlineAct[]
    onChange: (acts: OutlineAct[]) => void
}

/** 结构纲：三幕 / 起承转合 / 英雄之旅的节拍表 */
export function StructurePanel({ acts, onChange }: StructurePanelProps): JSX.Element {
    const handlePatch = (actId: string, patch: Partial<OutlineAct>): void => {
        onChange(acts.map((act) => (act.id === actId ? { ...act, ...patch } : act)))
    }

    return (
        <PanelShell
            title="结构纲"
            description="标出激励事件、第一次转折、中点、低谷与高潮：先定大转折，再拆卷章"
            action={
                <Button variant="outline" onClick={() => onChange([...acts, createAct()])}>
                    <Plus />
                    添加阶段
                </Button>
            }
        >
            {acts.length === 0 ? (
                <p className="text-muted-foreground">还没有结构阶段。先写下「开端 / 对抗 / 高潮」，再逐条补事件。</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {acts.map((act, index) => (
                        <Card key={act.id} size="sm">
                            <CardContent className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
                                    <Input
                                        value={act.name}
                                        aria-label={`第 ${index + 1} 个阶段名`}
                                        placeholder="阶段名：开端 / 中点 / 低谷 / 高潮"
                                        className="h-7 font-medium"
                                        onChange={(event) => handlePatch(act.id, { name: event.target.value })}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 rounded-full"
                                        aria-label={`删除第 ${index + 1} 个阶段`}
                                        onClick={() => onChange(acts.filter((item) => item.id !== act.id))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <OutlineTextField
                                    id={`outline-act-position-${act.id}`}
                                    label="位置"
                                    value={act.position}
                                    placeholder="打破平衡 / 升级对抗 / 迫使选择"
                                    onChange={(position) => handlePatch(act.id, { position })}
                                />
                                <OutlineTextArea
                                    id={`outline-act-event-${act.id}`}
                                    label="关键事件"
                                    value={act.event}
                                    placeholder="这一阶段真正发生了什么，主角因此改变了什么"
                                    onChange={(event) => handlePatch(act.id, { event })}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </PanelShell>
    )
}

interface CharacterOutlinePanelProps {
    lines: OutlineCharacterLine[]
    characters: CharacterCard[]
    onChange: (lines: OutlineCharacterLine[]) => void
}

/** 人物纲：每个主要人物的欲望、恐惧、缺陷、秘密、关系与弧光终点 */
export function CharacterOutlinePanel({ lines, characters, onChange }: CharacterOutlinePanelProps): JSX.Element {
    const handlePatch = (lineId: string, patch: Partial<OutlineCharacterLine>): void => {
        onChange(lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)))
    }

    /** 从人物卡导入：只补尚未入纲的人物，已入纲的保持作者填写的版本 */
    const handleImport = (): void => {
        const existing = new Set(lines.map((line) => line.characterId).filter((id) => id.length > 0))
        const additions = characters
            .filter((character) => !existing.has(character.id))
            .map((character) =>
                createCharacterLine(character.name, {
                    characterId: character.id,
                    desire: character.desire,
                    flaw: character.weakness,
                    relation: character.relation,
                    arc: character.arc,
                }),
            )
        if (additions.length > 0) {
            onChange([...lines, ...additions])
        }
    }

    return (
        <PanelShell
            title="人物纲"
            description="事件必须能逼人物做选择：写清欲望、恐惧、缺陷与弧光终点，而不是只列性格标签"
            action={
                <div className="flex shrink-0 gap-1">
                    <Button variant="outline" disabled={characters.length === 0} onClick={handleImport}>
                        <UserPlus />
                        从人物卡导入
                    </Button>
                    <Button variant="outline" onClick={() => onChange([...lines, createCharacterLine()])}>
                        <Plus />
                        添加
                    </Button>
                </div>
            }
        >
            {lines.length === 0 ? (
                <p className="text-muted-foreground">还没有人物纲。先从人物卡导入，再补上「他为什么非这么做不可」。</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {lines.map((line, index) => (
                        <Card key={line.id} size="sm">
                            <CardContent className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Input
                                        value={line.name}
                                        aria-label={`第 ${index + 1} 个人物姓名`}
                                        placeholder="角色名"
                                        className="h-7 font-medium"
                                        onChange={(event) => handlePatch(line.id, { name: event.target.value })}
                                    />
                                    <Select
                                        value={line.characterId.length > 0 ? line.characterId : 'none'}
                                        onValueChange={(value) =>
                                            handlePatch(line.id, { characterId: value === 'none' ? '' : value })
                                        }
                                    >
                                        <SelectTrigger aria-label="关联人物卡" className="h-7 w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                <SelectItem value="none">未关联</SelectItem>
                                                {characters.map((character) => (
                                                    <SelectItem key={character.id} value={character.id}>
                                                        {character.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 rounded-full"
                                        aria-label={`删除第 ${index + 1} 个人物纲`}
                                        onClick={() => onChange(lines.filter((item) => item.id !== line.id))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                                    <OutlineTextField
                                        id={`outline-cline-desire-${line.id}`}
                                        label="欲望"
                                        value={line.desire}
                                        placeholder="他最想要什么"
                                        onChange={(desire) => handlePatch(line.id, { desire })}
                                    />
                                    <OutlineTextField
                                        id={`outline-cline-fear-${line.id}`}
                                        label="恐惧"
                                        value={line.fear}
                                        placeholder="他最怕失去什么"
                                        onChange={(fear) => handlePatch(line.id, { fear })}
                                    />
                                    <OutlineTextField
                                        id={`outline-cline-flaw-${line.id}`}
                                        label="缺陷"
                                        value={line.flaw}
                                        placeholder="什么让他在关键时刻选错"
                                        onChange={(flaw) => handlePatch(line.id, { flaw })}
                                    />
                                    <OutlineTextField
                                        id={`outline-cline-secret-${line.id}`}
                                        label="秘密"
                                        value={line.secret}
                                        placeholder="读者与角色之间的信息差"
                                        onChange={(secret) => handlePatch(line.id, { secret })}
                                    />
                                </div>
                                <OutlineTextField
                                    id={`outline-cline-relation-${line.id}`}
                                    label="关系"
                                    value={line.relation}
                                    placeholder="与谁的关系最关键，这份关系会怎么变"
                                    onChange={(relation) => handlePatch(line.id, { relation })}
                                />
                                <OutlineTextField
                                    id={`outline-cline-arc-${line.id}`}
                                    label="弧光终点"
                                    value={line.arc}
                                    placeholder="从____到____"
                                    onChange={(arc) => handlePatch(line.id, { arc })}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </PanelShell>
    )
}

interface SettingOutlinePanelProps {
    notes: OutlineSettingNote[]
    onChange: (notes: OutlineSettingNote[]) => void
}

/** 设定纲：只写会推动情节的世界规则、势力与能力代价 */
export function SettingOutlinePanel({ notes, onChange }: SettingOutlinePanelProps): JSX.Element {
    const handlePatch = (noteId: string, patch: Partial<OutlineSettingNote>): void => {
        onChange(notes.map((note) => (note.id === noteId ? { ...note, ...patch } : note)))
    }

    return (
        <PanelShell
            title="设定纲"
            description="只写会推动情节的部分：规则、代价与限制；完整世界观仍在「设定」页维护"
            action={
                <Button variant="outline" onClick={() => onChange([...notes, createSettingNote()])}>
                    <Plus />
                    添加条目
                </Button>
            }
        >
            {notes.length === 0 ? (
                <p className="text-muted-foreground">还没有设定纲。先写「哪条规则会让主角付出代价」。</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {notes.map((note, index) => (
                        <Card key={note.id} size="sm">
                            <CardContent className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Input
                                        value={note.name}
                                        aria-label={`第 ${index + 1} 个设定名`}
                                        placeholder="规则 / 势力 / 地点 / 能力"
                                        className="h-7 font-medium"
                                        onChange={(event) => handlePatch(note.id, { name: event.target.value })}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 rounded-full"
                                        aria-label={`删除第 ${index + 1} 个设定`}
                                        onClick={() => onChange(notes.filter((item) => item.id !== note.id))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                                    <OutlineTextField
                                        id={`outline-snote-rule-${note.id}`}
                                        label="规则"
                                        value={note.rule}
                                        placeholder="这个世界怎么运作"
                                        onChange={(rule) => handlePatch(note.id, { rule })}
                                    />
                                    <OutlineTextField
                                        id={`outline-snote-cost-${note.id}`}
                                        label="代价"
                                        value={note.cost}
                                        placeholder="用它要付出什么"
                                        onChange={(cost) => handlePatch(note.id, { cost })}
                                    />
                                </div>
                                <OutlineTextField
                                    id={`outline-snote-note-${note.id}`}
                                    label="说明"
                                    value={note.note}
                                    placeholder="会在哪一卷、以什么方式推动情节"
                                    onChange={(value) => handlePatch(note.id, { note: value })}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </PanelShell>
    )
}

interface PacingPanelProps {
    entries: OutlinePacingEntry[]
    chapters: OutlineChapter[]
    onChange: (entries: OutlinePacingEntry[]) => void
}

/** 节奏/情绪：一章一档，避免连续同类章节 */
export function PacingPanel({ entries, chapters, onChange }: PacingPanelProps): JSX.Element {
    const chapterOrders = chapters.map((chapter) => chapter.order)
    const handlePatch = (entryId: string, patch: Partial<OutlinePacingEntry>): void => {
        onChange(entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)))
    }
    /** 按章纲同步：补齐缺失章，删掉已不在本卷的章，保留作者已填的类型与张力 */
    const handleSync = (): void => {
        const existing = new Map(entries.map((entry) => [entry.chapterOrder, entry]))
        const next = chapterOrders.map((order) => existing.get(order) ?? createPacingEntry(order))
        onChange(next)
    }

    const sorted = [...entries].sort((left, right) => left.chapterOrder - right.chapterOrder)
    /** 第一个与上一章同类型的节奏行：用于提示「连续同类章节」 */
    const repeated = sorted.find((entry, index) => index > 0 && sorted[index - 1]?.kind === entry.kind)

    return (
        <PanelShell
            title="节奏情绪"
            description="每章标一个类型与张力：紧张、铺垫、爽点、虐点、喘息交替出现，避免连续同类章节"
            action={
                <Button variant="outline" disabled={chapters.length === 0} onClick={handleSync}>
                    按章纲同步
                </Button>
            }
        >
            {sorted.length === 0 ? (
                <p className="text-muted-foreground">还没有节奏记录。点「按章纲同步」把当前各章的节奏行补出来。</p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    {sorted.map((entry) => (
                        <div
                            key={entry.id}
                            className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
                        >
                            <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                                第{entry.chapterOrder}章
                            </span>
                            <Select
                                value={entry.kind}
                                onValueChange={(value) => {
                                    const next = PACING_KIND_ORDER.find((kind) => kind === value)
                                    if (next !== undefined) {
                                        handlePatch(entry.id, { kind: next })
                                    }
                                }}
                            >
                                <SelectTrigger aria-label={`第${entry.chapterOrder}章节奏类型`} className="h-7 w-24">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {PACING_KIND_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <Slider
                                value={[entry.tension]}
                                min={1}
                                max={5}
                                step={1}
                                aria-label={`第${entry.chapterOrder}章张力`}
                                className="min-w-16 flex-1"
                                onValueChange={(values) => {
                                    const next = values[0]
                                    if (typeof next === 'number') {
                                        handlePatch(entry.id, { tension: next })
                                    }
                                }}
                            />
                            <span className="w-16 shrink-0 text-right text-muted-foreground">
                                {TENSION_LABELS[entry.tension - 1] ?? ''}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 rounded-full"
                                aria-label={`删除第${entry.chapterOrder}章节奏`}
                                onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    ))}
                </div>
            )}
            {entries.some((entry) => !chapterOrders.includes(entry.chapterOrder)) ? (
                <p className="text-muted-foreground">有节奏行指向已不存在的章，可点「按章纲同步」清理。</p>
            ) : null}
            {repeated === undefined ? null : (
                <p className="text-muted-foreground">
                    第{repeated.chapterOrder}章与前章同为「{PACING_META[repeated.kind].label}」，可考虑调整其中一章。
                </p>
            )}
        </PanelShell>
    )
}
