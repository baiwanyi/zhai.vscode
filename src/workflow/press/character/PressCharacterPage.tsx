/**
 * 人物设定页：写作流程的第三步，用角色下拉筛选与关键词收敛卡片列表，点卡片在弹窗内编辑。
 * 复用约定：外壳取 components/AppPage（作品名走 AppDescription 眉标、筛选行进 AppMenu、列表走 AppContent 滚动），
 * 列表由 CharacterList 承担、编辑由 CharacterEditDialog 与 CharacterDetail 承担、
 * 新增由 CharacterCreateDialog 承担、提取由 useCharacterExtract 发起、封面画廊由 useCharacterPortrait 读取；
 * 搜索框复用 ui/input-group（前置图标交给 InputGroupAddon），提取中的等待态复用 components/StateEmpty；
 * 本文件只做筛选、搜索、提取、封面回读与弹窗编排，以及作品氛围、作品目录的下传。
 * 关键约束：新增后直接打开编辑弹窗，因此 onCreateCharacter 必须回传新卡 id；
 * 编辑弹窗以人物 id 作为 key 重建，关闭即丢弃草稿，页面不保留编辑中间态；
 * 提取得到的是草案，建卡与同名补全由父级完成，页面只负责刷新列表；
 * 画廊只在「作品目录、角色数、封面 id 组合」变化时重读——保存封面后卡片立刻显示新图，日常输入不会反复扫盘。
 */
import { Plus, Search, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { PortraitGalleryItem, PressExtractedCharacter } from '@shared/types/press'
import {
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { CharacterCreateDialog } from './CharacterCreateDialog'
import { CharacterEditDialog } from './CharacterEditDialog'
import { CharacterList } from './CharacterList'
import { useCharacterExtract } from './useCharacterExtract'
import { useCharacterPortrait } from './useCharacterPortrait'
import type { AppearanceContext } from './useCharacterAppearance'
import type { CharacterCard, CharacterRole, CharacterSeed, ProjectSetting } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_FILTERS } from '../constants'

interface PressCharacterPageProps {
    characters: CharacterCard[]
    /** 作品设定：外貌生成需要时代、题材与基调 */
    setting: ProjectSetting
    /** 当前作品目录：角色卡图片落在该作品的 Portraits 下 */
    dirPath: string
    /** 建卡并返回新卡 id，供页面直接打开编辑弹窗 */
    onCreateCharacter: (seed: CharacterSeed) => string
    onChangeCharacter: (id: string, patch: Partial<CharacterCard>) => void
    /** 删除人物并清理章纲中的出场引用 */
    onDeleteCharacter: (id: string) => void
    /** 合并提取出的人物卡并返回新建与补全人数；重名人物只补空字段、空名由父级跳过 */
    onExtractCharacters: (drafts: PressExtractedCharacter[]) => { created: number; updated: number }
}

export function PressCharacterPage({
    characters,
    setting,
    dirPath,
    onCreateCharacter,
    onChangeCharacter,
    onDeleteCharacter,
    onExtractCharacters,
}: PressCharacterPageProps): JSX.Element {
    const [query, setQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState<CharacterRole | 'all'>('all')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [galleries, setGalleries] = useState<Record<string, PortraitGalleryItem[]>>({})
    const { isExtracting, progress, extract } = useCharacterExtract(dirPath)
    const { listGallery } = useCharacterPortrait(dirPath)

    /**
     * 画廊刷新信号：只把「角色集合 + 各自封面」压成字符串作为依赖。
     * 直接依赖 characters 数组会让每次输入都重读磁盘，压成字符串后只有封面或人数变化才触发。
     */
    const galleryKey = useMemo(
        () => `${characters.length}|${characters.map((item) => `${item.id}:${item.coverPortraitId ?? ''}`).join(',')}`,
        [characters],
    )

    useEffect(() => {
        let cancelled = false
        void listGallery().then((items) => {
            if (!cancelled) {
                setGalleries(items)
            }
        })
        return (): void => {
            cancelled = true
        }
    }, [galleryKey, listGallery])

    /** 删除后关闭可能停留的编辑弹窗，避免弹窗继续编辑一张已不存在的卡 */
    const handleDeleteCharacter = useCallback(
        (id: string): void => {
            setEditingId((previous) => (previous === id ? null : previous))
            onDeleteCharacter(id)
        },
        [onDeleteCharacter],
    )

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

    /** 提取人物：进度与结果只在列表区呈现，不再弹 sonner 提示 */
    const handleExtract = (): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null || result.characters.length === 0) {
                return
            }
            // 合并进草稿即写盘，列表刷新本身就是完成反馈
            onExtractCharacters(result.characters)
        }
        void run()
    }

    return (
        <>
            <AppPage>
                <AppHeader>
                    {/* 眉标：作品名与说明同用弱化小字，避免与页面标题争夺主视觉 */}
                    <AppDescription>{setting.title}</AppDescription>
                    <AppTitle>人物设定</AppTitle>
                    <AppDescription>共 {characters.length} 人 · 欲望与弱点决定冲突，大纲排布时会引用</AppDescription>
                    <AppMenu>
                        <Select value={roleFilter} onValueChange={handleFilterChange}>
                            <SelectTrigger className="h-8 w-24" aria-label="角色筛选">
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
                        <InputGroup className="min-w-0 flex-1">
                            <InputGroupAddon>
                                <Search />
                            </InputGroupAddon>
                            <InputGroupInput
                                value={query}
                                aria-label="搜索人物"
                                placeholder="搜索姓名、昵称或身份"
                                onChange={(event) => setQuery(event.target.value)}
                            />
                        </InputGroup>
                    </AppMenu>
                </AppHeader>
                <AppContent isScrollable>
                    {isExtracting ? (
                        // 提取期间整块替换为加载态：进度文案由宿主逐批回传，形如「角色卡 3/5」
                        <StateEmpty
                            title="正在提取人物卡"
                            isLoading
                            loadingLabel={progress?.message ?? '正在提取人物卡…'}
                            className="flex-1 justify-center"
                        />
                    ) : (
                        <CharacterList
                            characters={visibleCharacters}
                            totalCount={characters.length}
                            hasFilter={hasFilter}
                            galleries={galleries}
                            onSelect={setEditingId}
                            onCreate={() => setIsCreateOpen(true)}
                            onExtract={handleExtract}
                            onClearFilter={handleClearFilter}
                            onDelete={handleDeleteCharacter}
                        />
                    )}
                </AppContent>
                <AppFooter>
                    <Button variant="outline" disabled={isExtracting} onClick={handleExtract}>
                        <Sparkles />
                        {isExtracting ? '提取中' : '提取'}
                    </Button>
                    <Button disabled={isExtracting} onClick={() => setIsCreateOpen(true)}>
                        <Plus />
                        新增
                    </Button>
                </AppFooter>
            </AppPage>

            {/* key 绑定展开状态：每次打开都重建表单，上一次的输入不会带过来 */}
            <CharacterCreateDialog
                key={isCreateOpen ? 'create-open' : 'create-closed'}
                open={isCreateOpen}
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
        </>
    )
}
