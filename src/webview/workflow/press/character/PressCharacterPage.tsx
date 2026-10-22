/**
 * 人物设定页：写作流程的第三步，用角色下拉筛选与关键词收敛卡片列表，点卡片在弹窗内编辑。
 * 复用约定：列表由 CharacterList 承担、编辑由 CharacterEditDialog 与 CharacterDetail 承担、
 * 新增由 CharacterCreateDialog 承担；本文件只做筛选、搜索、弹窗编排与作品氛围的下传。
 * 关键约束：新增后直接打开编辑弹窗，因此 onCreateCharacter 必须回传新卡 id；
 * 编辑弹窗以人物 id 作为 key 重建，关闭即丢弃草稿，页面不保留编辑中间态。
 */
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Separator } from '@components/ui/separator'
import { CharacterCreateDialog } from './CharacterCreateDialog'
import { CharacterEditDialog } from './CharacterEditDialog'
import { CharacterList } from './CharacterList'
import type { AppearanceContext } from './useCharacterAppearance'
import type { CharacterCard, CharacterRole, CharacterSeed, ProjectSetting } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_FILTERS } from '../constants'

interface PressCharacterPageProps {
    characters: CharacterCard[]
    /** 作品设定：外貌生成需要时代、题材与基调 */
    setting: ProjectSetting
    /** 建卡并返回新卡 id，供页面直接打开编辑弹窗 */
    onCreateCharacter: (seed: CharacterSeed) => string
    onChangeCharacter: (id: string, patch: Partial<CharacterCard>) => void
}

export function PressCharacterPage({
    characters,
    setting,
    onCreateCharacter,
    onChangeCharacter,
}: PressCharacterPageProps): JSX.Element {
    const [query, setQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState<CharacterRole | 'all'>('all')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)

    const editingCharacter = characters.find((character) => character.id === editingId) ?? null
    // 作品氛围只在设定字段变化时重建，避免弹窗内每次输入都触发新对象
    const aiContext = useMemo<AppearanceContext>(
        () => ({ era: setting.era, genres: setting.genres, tone: setting.tone }),
        [setting.era, setting.genres, setting.tone],
    )

    // 过滤只覆盖列表可见性：检索匹配姓名、昵称与身份，不搜索人物卡正文，避免常用字命中整份设定
    const visibleCharacters = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        return characters.filter((character) => {
            if (roleFilter !== 'all' && character.role !== roleFilter) {
                return false
            }
            if (keyword.length === 0) {
                return true
            }
            return [character.name, character.alias, character.identity].some((field) =>
                field.toLowerCase().includes(keyword),
            )
        })
    }, [characters, query, roleFilter])

    const hasFilter = query.trim().length > 0 || roleFilter !== 'all'

    const handleFilterChange = (value: string): void => {
        if (value.length === 0) {
            return
        }
        const next = CHARACTER_ROLE_FILTERS.find((option) => option.value === value)
        if (next) {
            setRoleFilter(next.value)
        }
    }

    const handleClearFilter = (): void => {
        setQuery('')
        setRoleFilter('all')
    }

    const handleCreate = (seed: CharacterSeed): void => {
        setEditingId(onCreateCharacter(seed))
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-2 p-3">
            <header className="flex shrink-0 flex-col gap-2">
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading text-sm font-semibold">人物设定</h2>
                        <p className="truncate text-xs text-muted-foreground tabular-nums">
                            共 {characters.length} 人 · 欲望与弱点决定冲突，大纲排布时会引用
                        </p>
                    </div>
                    <Button className="shrink-0" onClick={() => setIsCreateOpen(true)}>
                        <Plus data-icon="inline-start" />
                        新增
                    </Button>
                </div>
                <Separator />
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={roleFilter} onValueChange={handleFilterChange}>
                        <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="角色筛选">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {CHARACTER_ROLE_FILTERS.map((option) => (
                                    <SelectItem key={option.value} value={option.value} className="text-xs">
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <div className="relative min-w-0 flex-1">
                        <Search
                            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <Input
                            value={query}
                            aria-label="搜索人物"
                            placeholder="搜索姓名、昵称或身份"
                            className="h-7 pl-7 text-xs"
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </div>
                </div>
                <Separator />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                <CharacterList
                    characters={visibleCharacters}
                    totalCount={characters.length}
                    hasFilter={hasFilter}
                    onSelect={setEditingId}
                    onCreate={() => setIsCreateOpen(true)}
                    onClearFilter={handleClearFilter}
                />
            </div>
            {/* key 绑定展开状态：每次打开都重建表单，上一次的输入不会带过来 */}
            <CharacterCreateDialog
                key={isCreateOpen ? 'create-open' : 'create-closed'}
                isOpen={isCreateOpen}
                onOpenChange={setIsCreateOpen}
                onCreate={handleCreate}
            />
            {editingCharacter !== null ? (
                <CharacterEditDialog
                    key={editingCharacter.id}
                    character={editingCharacter}
                    aiContext={aiContext}
                    onSave={onChangeCharacter}
                    onCancel={() => setEditingId(null)}
                />
            ) : null}
        </div>
    )
}
