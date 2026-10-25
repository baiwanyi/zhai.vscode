/**
 * 生图页：以筛选条 + 图片网格管理当前作品的封面、角色图与普通图片。
 * 复用约定：数据经 useImageLibrary 获取，网格由 ImageGenGrid 渲染，
 * 空态取 @components/ui/empty，筛选按钮取 @components/ui/button，不手写卡片容器。
 * 关键约束：筛选条件全部在内存中计算，不重复请求宿主；
 * 「作品封面」是筛选维度而非图片类别——由 coverSelectedId 与图片 id 比较得出；
 * 删除是破坏性操作，落盘侧进回收站，本节只刷新列表，不做乐观删除。
 */
import { ImageIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Input } from '@components/ui/input'
import type { PressImageItem, PressImageKind } from '@shared/types/imagegen'
import { ImageComposer } from './ImageComposer'
import { ImageGenGrid } from './ImageGenGrid'
import { useImageLibrary } from './useImageLibrary'
import type { PromptSettingSnapshot } from './ImageComposer'
import type { JSX } from 'react'

/** 类型筛选：封面是「当前选中」维度，与图片自身的类别并列展示 */
type KindFilter = 'all' | 'cover' | PressImageKind

const KIND_FILTERS: ReadonlyArray<{ value: KindFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'cover', label: '作品封面' },
    { value: 'portrait', label: '角色图' },
    { value: 'photo', label: '普通图' },
    { value: 'orphan', label: '未归类' },
]

interface ImageGenPageProps {
    /** 当前作品目录：既是数据作用域，也是切换作品时的重建依据 */
    dirPath: string
    /** 角色清单：用于人物筛选、卡片角标与封面指针修复 */
    characters: ReadonlyArray<{ id: string; name: string; coverPortraitId: string | null }>
    /** 作品设定快照：命令动作选中「作品设定」时展开进提示词 */
    setting: PromptSettingSnapshot
    /** 写回人物卡封面指针：删除与生成后同步，保证角色卡页与本页一致 */
    onChangeCharacter: (characterId: string, patch: { coverPortraitId: string | null }) => void
}

export function ImageGenPage({ dirPath, characters, setting, onChangeCharacter }: ImageGenPageProps): JSX.Element {
    const { images, coverSelectedId, isLoading, removeImage, reload } = useImageLibrary(dirPath)
    const [kind, setKind] = useState<KindFilter>('all')
    const [characterId, setCharacterId] = useState('all')
    const [keyword, setKeyword] = useState('')

    const characterNames = useMemo(
        () => new Map(characters.map((character) => [character.id, character.name])),
        [characters],
    )

    const filtered = useMemo(() => {
        const text = keyword.trim().toLowerCase()
        return images.filter((image) => {
            if (characterId !== 'all' && image.characterId !== characterId) {
                return false
            }
            if (kind === 'cover' && image.id !== coverSelectedId) {
                return false
            }
            if (kind !== 'all' && kind !== 'cover' && image.kind !== kind) {
                return false
            }
            if (text.length === 0) {
                return true
            }
            const name = image.characterId === null ? '' : (characterNames.get(image.characterId) ?? '')
            return name.toLowerCase().includes(text) || image.id.toLowerCase().includes(text)
        })
    }, [images, kind, characterId, keyword, coverSelectedId, characterNames])

    /**
     * 删除图片并同步角色封面：宿主已算好回退值，此处只在「被删图正是该角色当前封面」时写回，
     * 避免把已经被用户改过的封面又覆盖回去。
     */
    const handleDelete = async (image: PressImageItem): Promise<void> => {
        const result = await removeImage(image)
        if (result === null || !result.removed || result.characterId === null) {
            return
        }
        const target = characters.find((character) => character.id === result.characterId)
        if (target === undefined || target.coverPortraitId !== image.id) {
            return
        }
        onChangeCharacter(result.characterId, { coverPortraitId: result.nextPortraitId })
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
                {KIND_FILTERS.map((filter) => (
                    <Button
                        key={filter.value}
                        type="button"
                        size="sm"
                        variant={kind === filter.value ? 'secondary' : 'ghost'}
                        onClick={() => setKind(filter.value)}
                    >
                        {filter.label}
                    </Button>
                ))}
                <div className="ml-2 flex items-center gap-1.5 overflow-x-auto">
                    <Button
                        type="button"
                        size="sm"
                        variant={characterId === 'all' ? 'secondary' : 'ghost'}
                        onClick={() => setCharacterId('all')}
                    >
                        全部角色
                    </Button>
                    {characters.map((character) => (
                        <Button
                            key={character.id}
                            type="button"
                            size="sm"
                            variant={characterId === character.id ? 'secondary' : 'ghost'}
                            onClick={() => setCharacterId(character.id)}
                        >
                            {character.name}
                        </Button>
                    ))}
                </div>
                <Input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索角色或文件名"
                    className="ml-auto h-7 w-44"
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoading ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ImageIcon />
                            </EmptyMedia>
                            <EmptyTitle>正在读取图片</EmptyTitle>
                            <EmptyDescription>首次打开需要扫描作品目录，稍候即可</EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : filtered.length === 0 ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ImageIcon />
                            </EmptyMedia>
                            <EmptyTitle>{images.length === 0 ? '还没有图片' : '没有符合条件的图片'}</EmptyTitle>
                            <EmptyDescription>
                                {images.length === 0
                                    ? '在下方输入提示词生成第一张，或先在设定页生成作品封面'
                                    : '换个筛选条件或清空搜索词再试'}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <ImageGenGrid
                        images={filtered}
                        coverSelectedId={coverSelectedId}
                        characterNames={characterNames}
                        onDelete={(image) => void handleDelete(image)}
                    />
                )}
            </div>

            <ImageComposer
                dirPath={dirPath}
                characters={characters}
                setting={setting}
                activeCharacterId={characterId === 'all' ? null : characterId}
                defaultRatio="3:4"
                defaultStyle="auto"
                onGenerated={(result) => {
                    void reload()
                    if (characterId === 'all') {
                        return
                    }
                    // 该角色还没有封面时才自动认领，已有封面不被新图顶掉
                    const target = characters.find((character) => character.id === characterId)
                    if (target === undefined || target.coverPortraitId !== null) {
                        return
                    }
                    onChangeCharacter(characterId, { coverPortraitId: result.image.id })
                }}
            />
        </div>
    )
}
