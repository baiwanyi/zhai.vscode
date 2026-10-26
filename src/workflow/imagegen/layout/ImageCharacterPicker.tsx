/**
 * 生图角色选择器：工具栏角色按钮的下拉，列出作品全部人物卡，选中即挂上角色芯片。
 * 复用约定：外壳取 @components/ui 的 dropdown-menu，触发器取 @webview/components/Button
 * （尺寸 icon，已选角色时切 secondary 底色）。
 * 关键约束：单选语义交给 RadioGroup，勾选态由输入卡片按角色芯片传入；选「不使用角色」即清除芯片；
 * 本组件只上抛选中角色，芯片与生成目标的落盘由输入卡片承担。
 */
import { UserRoundStar } from 'lucide-react'
import { useMemo } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { PromptCharacterSnapshot } from '../prompt/promptSections'
import type { JSX } from 'react'

/** 「不使用角色」的菜单值：Radix 的单选需要一个稳定的字符串标识，空串不便与「未匹配」区分 */
const NO_CHARACTER = '__none__'

/** 角色名按字母序排列：用 'zh' 排序规则走拼音，中文名不会退化成码位比较 */
function sortByName(list: ReadonlyArray<PromptCharacterSnapshot>): PromptCharacterSnapshot[] {
    return [...list].sort((left, right) => left.name.localeCompare(right.name, 'zh'))
}

interface ImageCharacterPickerProps {
    /** 可选角色：作品下全部人物卡快照 */
    characters: ReadonlyArray<PromptCharacterSnapshot>
    /** 当前角色芯片指向的角色：null 表示不使用角色 */
    activeCharacterId: string | null
    onSelect: (character: PromptCharacterSnapshot | null) => void
}

export function ImageCharacterPicker({
    characters,
    activeCharacterId,
    onSelect,
}: ImageCharacterPickerProps): JSX.Element {
    /** 菜单里的角色按字母序排：作品里的人物卡没有固定次序，乱序展示找起来费劲 */
    const sortedCharacters = useMemo(() => sortByName(characters), [characters])

    /** 没匹配到角色的取值一律按「不使用角色」处理，避免菜单停在无对应项的位置 */
    const handleValueChange = (value: string): void => {
        onSelect(sortedCharacters.find((character) => character.id === value) ?? null)
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="icon"
                    variant={activeCharacterId === null ? 'ghost' : 'secondary'}
                    aria-label="角色设定"
                    tooltip="角色设定"
                >
                    <UserRoundStar />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
                {sortedCharacters.length === 0 ? (
                    <DropdownMenuItem disabled>暂无可选角色</DropdownMenuItem>
                ) : (
                    /* 滚动交给内层：外层不滚动，毛玻璃底色与描边才不会随内容滚出可视区（否则下半截发透） */
                    <div className="max-h-64 overflow-x-hidden overflow-y-auto">
                        <DropdownMenuRadioGroup
                            value={activeCharacterId ?? NO_CHARACTER}
                            onValueChange={handleValueChange}
                        >
                            <DropdownMenuRadioItem value={NO_CHARACTER}>不使用角色</DropdownMenuRadioItem>
                            {sortedCharacters.map((character) => (
                                <DropdownMenuRadioItem key={character.id} value={character.id}>
                                    {character.name}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
