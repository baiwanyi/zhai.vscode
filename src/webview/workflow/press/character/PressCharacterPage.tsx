/**
 * 人物设定页：写作流程的第三步，用角色下拉筛选与关键词收敛卡片列表，点卡片在弹窗内编辑。
 * 复用约定：列表由 CharacterList 承担、编辑由 CharacterEditDialog 与 CharacterDetail 承担、
 * 新增由 CharacterCreateDialog 承担、提取由 useCharacterExtract 发起；本文件只做筛选、搜索、
 * 提取与弹窗编排，以及作品氛围、作品目录的下传。
 * 关键约束：新增后直接打开编辑弹窗，因此 onCreateCharacter 必须回传新卡 id；
 * 编辑弹窗以人物 id 作为 key 重建，关闭即丢弃草稿，页面不保留编辑中间态；
 * 提取得到的是草案，合并与重名跳过由父级完成，页面只负责提示实际新增数量。
 */
import { Plus, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Separator } from '@components/ui/separator'
import type { PressExtractedCharacter } from '@shared/types/press'
import { CharacterCreateDialog } from './CharacterCreateDialog'
import { CharacterEditDialog } from './CharacterEditDialog'
import { CharacterList } from './CharacterList'
import { useCharacterExtract } from './useCharacterExtract'
import type { AppearanceContext } from './useCharacterAppearance'
import type { CharacterCard, CharacterRole, CharacterSeed, ProjectSetting } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_FILTERS } from '../constants'

interface PressCharacterPageProps {
    characters: CharacterCard[]
    /** 作品设定：外貌生成需要时代、题材与基调 */
    setting: ProjectSetting
    /** 当前作品目录：角色卡图片落在该作品的 _portraits 下 */
    dirPath: string
    /** 建卡并返回新卡 id，供页面直接打开编辑弹窗 */
    onCreateCharacter: (seed: CharacterSeed) => string
    onChangeCharacter: (id: string, patch: Partial<CharacterCard>) => void
    /** 合并提取出的人物卡并返回实际新增人数，重名与空名由父级跳过 */
    onExtractCharacters: (drafts: PressExtractedCharacter[]) => number
}

export function PressCharacterPage({
    characters,
    setting,
    dirPath,
    onCreateCharacter,
    onChangeCharacter,
    onExtractCharacters,
}: PressCharacterPageProps): JSX.Element {
    const [query, setQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState<CharacterRole | 'all'>('all')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const { isExtracting, extract } = useCharacterExtract(dirPath)

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

    const handleExtract = (): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null) {
                return
            }
            if (result.characters.length === 0) {
                toast.info(result.message)
                return
            }
            const added = onExtractCharacters(result.characters)
            if (added === 0) {
                toast.info('提取到的人物都已在列表中，未新增')
                return
            }
            toast.success(`已提取 ${String(added)} 个人物，年龄、外貌、背景与关系已按原文填入，请核对后保存`)
        }
        void run()
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-2 p-3">
            <header className="flex shrink-0 flex-col gap-2">
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading font-semibold">人物设定</h2>
                        <p className="truncate text-muted-foreground tabular-nums">
                            共 {characters.length} 人 · 欲望与弱点决定冲突，大纲排布时会引用
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                            variant="outline"
                            title="按出场统计、章节摘要与出场原文归纳人物卡（调用 AI），重名人物自动跳过"
                            disabled={isExtracting}
                            onClick={handleExtract}
                        >
                            <Sparkles data-icon="inline-start" />
                            {isExtracting ? '提取中' : '提取'}
                        </Button>
                        <Button onClick={() => setIsCreateOpen(true)}>
                            <Plus data-icon="inline-start" />
                            新增
                        </Button>
                    </div>
                </div>
                <Separator />
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={roleFilter} onValueChange={handleFilterChange}>
                        <SelectTrigger size="sm" className="h-7 w-24" aria-label="角色筛选">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {CHARACTER_ROLE_FILTERS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
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
                            className="h-7 pl-7"
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </div>
                </div>
                <Separator />
            </header>
            {/* 左右留 2px：滚动容器 overflow-y-auto 同时裁横向溢出，卡片聚焦环不能被切掉 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-0.5">
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
                    dirPath={dirPath}
                    onSave={onChangeCharacter}
                    onCancel={() => setEditingId(null)}
                />
            ) : null}
        </div>
    )
}
