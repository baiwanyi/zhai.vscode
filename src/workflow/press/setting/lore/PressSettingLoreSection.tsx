/**
 * 设定页条目分段：势力 / 地点 / 物品共用一套「列表 + 搜索 + 新增 + 编辑弹窗」的编排。
 * 复用约定：搜索框取 ui/input-group，新增按钮取 components/Button，列表与空态交给 LoreList，
 * 编辑草稿与描述生成交给 LoreEditDialog（内部走 useLoreDescriptionGenerate，本组件只提供整份设定与同类条目名），
 * 封面回读走 useLoreImages，出图走 useLoreGenerate，分类文案取自 constants 的 LORE_KIND_META。
 * 关键约束：只渲染当前分类的条目，搜索匹配名称、描述与（势力的）关联人物名；
 * 名称必填且同分类唯一——回写按标题整块匹配，重名会互相覆盖，必须在提交前拦下；
 * 新建与编辑共用同一个弹窗，key 用「create」或条目 id，切换即重建草稿，不保留上一次输入；
 * 封面地址以 coverImageId 为准，指针缺失时回落到该条目最新一张；生成成功后只在没有封面时写回指针。
 */
import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Button } from '@webview/components/Button'
import { LoreEditDialog } from './LoreEditDialog'
import { LoreList } from './LoreList'
import { useLoreGenerate } from './useLoreGenerate'
import { useLoreImages } from './useLoreImages'
import type { CharacterCard, LoreEntry, LoreKind, LoreSeed, ProjectSetting } from '../../types'
import type { JSX } from 'react'
import { LORE_KIND_META } from '../../constants'

interface PressSettingLoreSectionProps {
    kind: LoreKind
    /** 全量条目：本组件按分类过滤，避免调用方为三段各算一份 */
    entries: readonly LoreEntry[]
    characters: readonly CharacterCard[]
    /** 整份设定：条目描述的生成依据，随弹窗一起下传 */
    setting: ProjectSetting
    /** 当前作品目录：封面回读与出图都以它为作用域 */
    dirPath: string
    onCreate: (seed: LoreSeed) => string
    onUpdate: (loreId: string, patch: Partial<LoreEntry>) => void
    onDelete: (loreId: string) => void
}

export function PressSettingLoreSection({
    kind,
    entries,
    characters,
    setting,
    dirPath,
    onCreate,
    onUpdate,
    onDelete,
}: PressSettingLoreSectionProps): JSX.Element {
    const meta = LORE_KIND_META[kind]
    const [query, setQuery] = useState('')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const { listGallery } = useLoreImages(dirPath)
    const { isGenerating, generate } = useLoreGenerate(dirPath)
    /** 条目标识 → 封面地址：整表回读一次，卡片与弹窗共用 */
    const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})

    const kindEntries = useMemo(() => entries.filter((entry) => entry.kind === kind), [entries, kind])

    /** 人物标识到姓名：搜索与卡片徽标都按 id 查，省去多处线性查找 */
    const nameById = useMemo(() => new Map(characters.map((character) => [character.id, character.name])), [characters])

    const visibleEntries = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        if (keyword.length === 0) {
            return kindEntries
        }
        return kindEntries.filter((entry) => {
            if (entry.name.toLowerCase().includes(keyword) || entry.description.toLowerCase().includes(keyword)) {
                return true
            }
            // 势力额外匹配关联人物名：按人名找组织是常见诉求
            return (
                kind === 'faction' &&
                entry.memberIds.some((id) => (nameById.get(id) ?? '').toLowerCase().includes(keyword))
            )
        })
    }, [kindEntries, query, kind, nameById])

    const editingEntry = kindEntries.find((entry) => entry.id === editingId) ?? null

    /** 封面回读：整表按条目标识分组，指针优先、其次取该条目最新一张 */
    useEffect(() => {
        let isDisposed = false
        const run = async (): Promise<void> => {
            const galleries = await listGallery()
            if (isDisposed) {
                return
            }
            const next: Record<string, string> = {}
            for (const entry of kindEntries) {
                const images = galleries[entry.id] ?? []
                const cover = images.find((image) => image.id === entry.coverImageId) ?? images[0]
                if (cover !== undefined) {
                    next[entry.id] = cover.url
                }
            }
            setCoverUrls(next)
        }
        void run()
        return (): void => {
            isDisposed = true
        }
        // 条目数量变化即重新回读：新增、删除后封面指针与分组都可能变
    }, [listGallery, kindEntries])

    const closeDialog = (): void => {
        setEditingId(null)
        setIsCreating(false)
    }

    /** 提交草稿：名称必填、同分类不重名；id 为空即新建，否则按 id 更新 */
    const handleSubmit = (draft: LoreEntry): boolean => {
        const name = draft.name.trim()
        if (name.length === 0) {
            toast.error('请先填写名称')
            return false
        }
        if (kindEntries.some((entry) => entry.id !== draft.id && entry.name === name)) {
            toast.error(`已有同名${meta.label}，请换一个名称`)
            return false
        }
        if (draft.id.length === 0) {
            onCreate({ ...draft, name })
            return true
        }
        onUpdate(draft.id, { ...draft, name })
        return true
    }

    /** 生成设定图：成功即换封面，条目原本没有封面时才写回指针，避免覆盖作者已选的图 */
    const handleGenerateCover = useCallback(async (): Promise<void> => {
        if (editingEntry === null) {
            toast.info('先保存条目，再生成设定图')
            return
        }
        const image = await generate(editingEntry)
        if (image === null) {
            return
        }
        setCoverUrls((previous) => ({ ...previous, [editingEntry.id]: image.url }))
        if (editingEntry.coverImageId === null) {
            onUpdate(editingEntry.id, { coverImageId: image.id })
        }
    }, [editingEntry, generate, onUpdate])

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <InputGroup className="min-w-0 flex-1">
                    <InputGroupAddon>
                        <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={query}
                        aria-label={`搜索${meta.label}`}
                        placeholder={
                            kind === 'faction' ? '搜索势力名称、描述或关联人物' : `搜索${meta.label}名称或描述`
                        }
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </InputGroup>
                <Button onClick={() => setIsCreating(true)}>
                    <Plus />
                    新增{meta.label}
                </Button>
            </div>
            <LoreList
                kind={kind}
                entries={visibleEntries}
                totalCount={kindEntries.length}
                hasFilter={query.trim().length > 0}
                coverUrls={coverUrls}
                onSelect={setEditingId}
                onCreate={() => setIsCreating(true)}
                onClearFilter={() => setQuery('')}
                onDelete={onDelete}
            />
            {isCreating || editingEntry !== null ? (
                <LoreEditDialog
                    key={isCreating ? 'create' : editingEntry?.id}
                    kind={kind}
                    entry={isCreating ? null : editingEntry}
                    characters={characters}
                    setting={setting}
                    siblings={kindEntries.filter((entry) => entry.id !== editingEntry?.id).map((entry) => entry.name)}
                    coverUrl={editingEntry === null ? null : (coverUrls[editingEntry.id] ?? null)}
                    isGeneratingCover={isGenerating}
                    onGenerateCover={() => {
                        void handleGenerateCover()
                    }}
                    onSubmit={handleSubmit}
                    onCancel={closeDialog}
                />
            ) : null}
        </div>
    )
}
