/**
 * 词库编辑弹窗：维护自定义纠错词条（错误写法 → 建议写法、替换或仅提示）与忽略词。
 * 复用约定：骨架取 @webview/components/FormDialog，字段与控件取 @components/ui 的 field / input / select / item；
 * 词条行收敛为同文件组件 EntryRow，保存请求由 hooks/useProofreadLexicon 承担，本组件只负责编辑与本地校验。
 * 关键约束：任一词条或忽略词不合法即整体不提交，口径与后端逐条收窄保持一致；
 * 草稿状态只在挂载时初始化，调用方必须用 Hook 的 sessionKey 作 key 重挂载，才能拿到最新词库；
 * 全部留空的草稿行在保存时直接丢弃；保存成功后弹窗由 Hook 关闭，词库变更需重新校对才会反映到结果上。
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Item, ItemActions, ItemContent } from '@components/ui/item'
import { ScrollArea } from '@components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { ProofreadLexicon, ProofreadLexiconEntry } from '@shared/types/proofread'
import { Button } from '@webview/components/Button'
import { FormDialog } from '@webview/components/FormDialog'
import type { ProofreadLexiconInput } from '../hooks/useProofreadLexicon'
import type { JSX } from 'react'

/** 单个词条与忽略词的长度上限：与后端收窄口径一致 */
const MAX_WORD_LENGTH = 32

/** 单条说明的长度上限 */
const MAX_NOTE_LENGTH = 120

/** 词条写入方式：替换参与一键写回，仅提示只作为问题条目列出 */
const MODE_LABELS: Readonly<Record<ProofreadLexiconEntry['mode'], string>> = {
    replace: '一键替换',
    flag: '仅提示',
}

/** 处理方式的选项顺序：下拉里保持「替换 → 仅提示」，不依赖对象键序 */
const MODE_OPTIONS: readonly ProofreadLexiconEntry['mode'][] = ['replace', 'flag']

/** 弹窗说明：讲清两种词的作用与生效时机 */
const DIALOG_DESCRIPTION =
    '命中错误写法的词会按方式处理；忽略词不参与任何检查，适合放角色名与专有名词。保存后需重新校对才会生效。'

/** 字段说明：长度上限由常量拼出，改口径时不会漏改文案 */
const ENTRY_FIELD_HINT = `错误写法与建议写法都不能为空，各不超过 ${String(MAX_WORD_LENGTH)} 字。留空的草稿行在保存时自动丢弃。`
const IGNORE_FIELD_HINT = `忽略词不参与任何检查，每个不超过 ${String(MAX_WORD_LENGTH)} 字。`

/** 忽略词的校验提示：空值与超长共用一个口径 */
const IGNORE_INVALID_TEXT = `忽略词不能为空，且不超过 ${String(MAX_WORD_LENGTH)} 字`

/** 编辑中的词条：id 只用于列表渲染，落盘前丢弃 */
interface EntryDraft extends ProofreadLexiconEntry {
    id: number
}

interface ProofreadLexiconDialogProps {
    open: boolean
    /** 打开时载入的完整词库：未加载完成时按空库处理 */
    lexicon: ProofreadLexicon | null
    isSaving: boolean
    onOpenChange: (isOpen: boolean) => void
    onSave: (input: ProofreadLexiconInput) => void
    onOpenFile: () => void
}

/** 草稿行是否完全未填写：这类行在保存时丢弃，而不是报错 */
function isEmptyDraft(entry: ProofreadLexiconEntry): boolean {
    return entry.wrong.trim().length === 0 && entry.right.trim().length === 0 && (entry.note ?? '').trim().length === 0
}

/** 草稿行 id 序号：只用于列表渲染，组件重挂载后继续递增即可 */
let draftSeq = 0

/** 取下一个草稿行 id：初始化与新增行共用同一个递增口径 */
function nextDraftId(): number {
    draftSeq += 1
    return draftSeq
}

/** 把词库转成草稿行：调用方以 sessionKey 作 key 重挂载，故初始化一次即可 */
function buildDrafts(lexicon: ProofreadLexicon | null): EntryDraft[] {
    return (lexicon?.entries ?? []).map((entry) => ({ ...entry, id: nextDraftId() }))
}

/** 落盘整形：去掉首尾空白，说明为空时整个字段不写，超长按上限截断 */
function toEntryPayload(entry: ProofreadLexiconEntry): ProofreadLexiconEntry {
    const note = (entry.note ?? '').trim()
    const payload: ProofreadLexiconEntry = {
        wrong: entry.wrong.trim(),
        right: entry.right.trim(),
        mode: entry.mode,
    }
    if (note.length > 0) {
        payload.note = note.slice(0, MAX_NOTE_LENGTH)
    }
    return payload
}

interface EntryRowProps {
    entry: EntryDraft
    /** 只回传本行的补丁：行 id 由父级闭包绑定，行内不感知列表结构 */
    onChange: (patch: Partial<ProofreadLexiconEntry>) => void
    onRemove: () => void
}

/** 单个词条行：错误写法、建议写法与处理方式同排，删除动作固定在行尾 */
function EntryRow({ entry, onChange, onRemove }: EntryRowProps): JSX.Element {
    return (
        <Item variant="muted" size="xs">
            <ItemContent className="flex-row items-center gap-1.5">
                <Input
                    aria-label="错误写法"
                    placeholder="错误写法"
                    maxLength={MAX_WORD_LENGTH}
                    value={entry.wrong}
                    onChange={(event) => onChange({ wrong: event.target.value })}
                />
                <Input
                    aria-label="建议写法"
                    placeholder="建议写法"
                    maxLength={MAX_WORD_LENGTH}
                    value={entry.right}
                    onChange={(event) => onChange({ right: event.target.value })}
                />
                <Select
                    value={entry.mode}
                    onValueChange={(value) => onChange({ mode: value === 'flag' ? 'flag' : 'replace' })}
                >
                    <SelectTrigger size="sm" aria-label="处理方式" className="w-24 shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {MODE_OPTIONS.map((mode) => (
                            <SelectItem key={mode} value={mode}>
                                {MODE_LABELS[mode]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </ItemContent>
            <ItemActions>
                <Button size="icon-xs" variant="ghost" tooltip="删除该词条" onClick={onRemove}>
                    <X />
                </Button>
            </ItemActions>
        </Item>
    )
}

export function ProofreadLexiconDialog({
    open,
    lexicon,
    isSaving,
    onOpenChange,
    onSave,
    onOpenFile,
}: ProofreadLexiconDialogProps): JSX.Element {
    const [entries, setEntries] = useState<EntryDraft[]>(() => buildDrafts(lexicon))
    const [ignores, setIgnores] = useState<string[]>(() => lexicon?.ignores ?? [])
    const [ignoreDraft, setIgnoreDraft] = useState('')
    const [error, setError] = useState<string | null>(null)

    function addEntry(): void {
        setEntries((current) => [...current, { id: nextDraftId(), wrong: '', right: '', mode: 'replace' }])
        setError(null)
    }

    function updateEntry(id: number, patch: Partial<ProofreadLexiconEntry>): void {
        setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
    }

    function removeEntry(id: number): void {
        setEntries((current) => current.filter((entry) => entry.id !== id))
    }

    function addIgnore(): void {
        const word = ignoreDraft.trim()
        if (word.length === 0 || word.length > MAX_WORD_LENGTH) {
            setError(IGNORE_INVALID_TEXT)
            return
        }
        setIgnoreDraft('')
        setError(null)
        if (ignores.includes(word)) {
            return
        }
        setIgnores((current) => [...current, word])
    }

    function removeIgnore(word: string): void {
        setIgnores((current) => current.filter((item) => item !== word))
    }

    /** 待提交的忽略词：输入框里还没点「添加」的一并生效，超长时置错误并返回 null */
    function collectIgnoreList(): string[] | null {
        const pending = ignoreDraft.trim()
        if (pending.length > MAX_WORD_LENGTH) {
            setError(IGNORE_INVALID_TEXT)
            return null
        }
        if (pending.length === 0 || ignores.includes(pending)) {
            return ignores
        }
        return [...ignores, pending]
    }

    /** 待提交的词条：留空行丢弃，任一必填项为空或超长即整体不提交 */
    function collectEntries(): ProofreadLexiconEntry[] | null {
        const payload: ProofreadLexiconEntry[] = []
        for (const entry of entries) {
            if (isEmptyDraft(entry)) {
                continue
            }
            const wrong = entry.wrong.trim()
            const right = entry.right.trim()
            if (wrong.length === 0 || right.length === 0) {
                setError('词条的错误写法与建议写法都不能为空')
                return null
            }
            if (wrong.length > MAX_WORD_LENGTH || right.length > MAX_WORD_LENGTH) {
                setError(`单条词条不超过 ${String(MAX_WORD_LENGTH)} 字`)
                return null
            }
            payload.push(toEntryPayload(entry))
        }
        return payload
    }

    function handleSubmit(): void {
        const nextIgnores = collectIgnoreList()
        if (nextIgnores === null) {
            return
        }
        const nextEntries = collectEntries()
        if (nextEntries === null) {
            return
        }
        setError(null)
        onSave({ entries: nextEntries, ignores: nextIgnores })
    }

    return (
        <FormDialog
            open={open}
            title="自定义词库"
            description={DIALOG_DESCRIPTION}
            submitLabel="保存词库"
            isSubmitting={isSaving}
            contentClassName="sm:max-w-2xl"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            {error !== null && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <Field>
                <FieldLabel>词条</FieldLabel>
                <FieldDescription>{ENTRY_FIELD_HINT}</FieldDescription>
                {entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">还没有词条，添加后按错误写法匹配。</p>
                ) : (
                    <ScrollArea className="max-h-64">
                        <div className="flex flex-col gap-1.5 pr-3">
                            {entries.map((entry) => (
                                <EntryRow
                                    key={entry.id}
                                    entry={entry}
                                    onChange={(patch) => updateEntry(entry.id, patch)}
                                    onRemove={() => removeEntry(entry.id)}
                                />
                            ))}
                        </div>
                    </ScrollArea>
                )}
                <Button size="xs" variant="outline" className="self-start" onClick={addEntry}>
                    <Plus />
                    添加词条
                </Button>
            </Field>
            <Field>
                <FieldLabel htmlFor="proofread-ignore-draft">忽略词</FieldLabel>
                <FieldDescription>{IGNORE_FIELD_HINT}</FieldDescription>
                <div className="flex items-center gap-1.5">
                    <Input
                        id="proofread-ignore-draft"
                        placeholder="角色名或专有名词"
                        maxLength={MAX_WORD_LENGTH}
                        value={ignoreDraft}
                        onChange={(event) => setIgnoreDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault()
                                addIgnore()
                            }
                        }}
                    />
                    <Button size="xs" variant="outline" onClick={addIgnore}>
                        <Plus />
                        添加
                    </Button>
                </div>
                {ignores.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {ignores.map((word) => (
                            <Button
                                key={word}
                                size="xs"
                                variant="secondary"
                                tooltip="移除此忽略词"
                                onClick={() => removeIgnore(word)}
                            >
                                {word}
                                <X />
                            </Button>
                        ))}
                    </div>
                )}
            </Field>
            <Button size="xs" variant="ghost" className="self-start" onClick={onOpenFile}>
                在编辑器中打开 JSON
            </Button>
        </FormDialog>
    )
}
