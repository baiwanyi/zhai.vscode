/**
 * 伏笔编辑对话框：编辑伏笔名、类型、埋设章、回收章、触发者、状态与备注，并只读展示逾期预警。
 * 复用约定：骨架取 @webview/components/Dialog，字段取 @components/ui/field，输入取 ui/input / textarea，下拉取 components/OptionSelect；
 * 人物单选复用 press/layout/CharacterSelectField，章节长列表取 @webview/components/SearchCombobox（顶部搜索 + 按卷分组 + 限高滚动），选项来自 ChapterRefOption；预警取 Alert，保存结果以 sonner 反馈。
 * 关键约束：编辑期只在本地草稿改，确认后一次性回传；调用方以伏笔 id 作 key，避免草稿串到上一次编辑的伏笔。
 */
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Alert } from '@webview/components/Alert'
import { Dialog } from '@webview/components/Dialog'
import { OptionSelect } from '@webview/components/OptionSelect'
import { SearchCombobox } from '@webview/components/SearchCombobox'
import type { SearchableGroup, SearchableOption } from '@webview/components/SearchCombobox'
import type { CharacterCard, OutlineClue } from '../../types'
import type { ChapterRefOption, ClueWarning } from '../../utils'
import type { JSX } from 'react'
import { CLUE_KIND_OPTIONS, CLUE_STATUS_OPTIONS } from '../../constants'
import { CharacterSelectField } from '../../layout/CharacterSelectField'
import { parseChapterRefValue, stripVolumeOrderPrefix } from '../../utils'

/** 章节引用下拉：空值用 none 表示未定，避免受控 Select 出现空串 */
const NO_REF = 'none'

/** 下拉回传字符串：none 还原为 null；解析失败回 undefined，由调用方保留原值 */
const toRef = (value: string): OutlineClue['plant'] | undefined =>
    value === NO_REF ? null : (parseChapterRefValue(value) ?? undefined)

/** 章节引用取值：受控 Select 的空值与「卷序-章序」互转 */
const chapterValue = (ref: OutlineClue['plant']): string =>
    ref === null ? NO_REF : `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`

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
        <Dialog
            size="full"
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
                    <CharacterSelectField
                        characters={characters}
                        label="触发者"
                        value={draft.triggerId}
                        dialogRef={dialogContentRef}
                        onChange={(characterId): void => patch({ triggerId: characterId })}
                    />
                    <Field>
                        <FieldLabel>状态</FieldLabel>
                        <OptionSelect
                            value={draft.status}
                            options={CLUE_STATUS_OPTIONS}
                            label="伏笔状态"
                            onChange={(status): void => patch({ status })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>类型</FieldLabel>
                        <OptionSelect
                            value={draft.kind}
                            options={CLUE_KIND_OPTIONS}
                            label="伏笔类型"
                            onChange={(kind): void => patch({ kind })}
                        />
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                    <SearchCombobox
                        label="埋设章"
                        value={[chapterValue(draft.plant)]}
                        groups={chapterGroups}
                        placeholder="搜索章节…"
                        emptyText="没有匹配的章节"
                        dialogRef={dialogContentRef}
                        onChange={(values): void => {
                            const selected = values[values.length - 1]
                            if (selected === undefined) {
                                return
                            }
                            const next = toRef(selected)
                            if (next !== undefined) {
                                patch({ plant: next })
                            }
                        }}
                    />
                    <SearchCombobox
                        label="回收章"
                        value={[chapterValue(draft.payoff)]}
                        groups={chapterGroups}
                        placeholder="搜索章节…"
                        emptyText="没有匹配的章节"
                        dialogRef={dialogContentRef}
                        onChange={(values): void => {
                            const selected = values[values.length - 1]
                            if (selected === undefined) {
                                return
                            }
                            const next = toRef(selected)
                            if (next !== undefined) {
                                patch({ payoff: next })
                            }
                        }}
                    />
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
