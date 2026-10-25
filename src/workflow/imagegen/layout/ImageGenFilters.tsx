/**
 * 生图页筛选区：类型与角色两个下拉加清空入口，占标题行下方的整行。
 * 适用范围：只用于作品内容的生图页；笔记与公众号内容不引入筛选——两边没有「作品封面」与角色的语义维度。
 * 复用约定：外壳取 components/AppPage 的 AppMenu，下拉取 @components/ui/select（选项带分项计数），
 * 按钮取 @webview/components/Button（图标按钮的可访问名由 aria-label 承担）。
 * 关键约束：受控组件，kind / characterId 与清空动作都由页面持有，组件不保存筛选状态；
 * 计数由页面算好后经 kindCounts 传入，组件不重复推导，避免口径分裂；
 * Select 回调只给 string，需经 isKindFilter 收窄后再上报；「作品封面」是筛选维度而非图片类别。
 */
import { X } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { type KindFilter } from '../hooks/useImageFilters'

const KIND_FILTERS: ReadonlyArray<{ value: KindFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'cover', label: '作品封面' },
    { value: 'portrait', label: '角色图' },
    { value: 'photo', label: '普通图' },
    { value: 'orphan', label: '未归类' },
]

/** 把下拉回调的字符串收窄回联合类型，避免用断言绕过类型检查 */
function isKindFilter(value: string): value is KindFilter {
    return KIND_FILTERS.some((filter) => filter.value === value)
}

/** 两个下拉的触发器共用尺寸：宽度固定，切换选项时整行筛选不会因文案长短而抖动 */
const TRIGGER_CLASS = 'w-28 shrink-0'

interface ImageGenFiltersProps {
    /** 当前类型筛选值 */
    kind: KindFilter
    /** 各筛选维度的数量：全部与作品封面由列表推导，其余取宿主分项数 */
    kindCounts: Readonly<Record<KindFilter, number>>
    onKindChange: (kind: KindFilter) => void
    /** 角色筛选值：'all' 表示不限 */
    characterId: string
    characters: ReadonlyArray<{ id: string; name: string }>
    onCharacterChange: (characterId: string) => void
    /** 是否有生效中的筛选：决定清空入口是否出现 */
    hasActiveFilter: boolean
    onClearFilters: () => void
}

export function ImageGenFilters({
    kind,
    kindCounts,
    onKindChange,
    characterId,
    characters,
    onCharacterChange,
    hasActiveFilter,
    onClearFilters,
}: ImageGenFiltersProps): JSX.Element {
    /** 下拉回调只给字符串：收窄成联合类型后再上报，非法值直接忽略 */
    const handleKindChange = (value: string): void => {
        if (isKindFilter(value)) {
            onKindChange(value)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={handleKindChange}>
                <SelectTrigger className={TRIGGER_CLASS} aria-label="按类型筛选">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {KIND_FILTERS.map((filter) => (
                            <SelectItem key={filter.value} value={filter.value}>
                                {filter.label}
                                <span className="text-muted-foreground ml-1 text-xs tabular-nums">
                                    {kindCounts[filter.value]}
                                </span>
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <Select value={characterId} onValueChange={onCharacterChange}>
                <SelectTrigger className={TRIGGER_CLASS} aria-label="按角色筛选">
                    {/* 角色可能在别处被删除，筛选值失效时回落到「全部角色」的文案而不是空触发区 */}
                    <SelectValue placeholder="全部角色" />
                </SelectTrigger>
                {/* 角色数量不定：限高 16rem 并在列表内滚动，选项少时随内容收缩。必须配 popper——默认 item-aligned 的定位写在父级 wrapper 的内联样式上，子元素覆盖不到，限高会把内容压到页面底部 */}
                <SelectContent position="popper" sideOffset={4} className="max-h-64">
                    <SelectGroup>
                        <SelectItem value="all">全部角色</SelectItem>
                        {characters.map((character) => (
                            <SelectItem key={character.id} value={character.id}>
                                {character.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            {hasActiveFilter && (
                <Button size="icon" tooltip="清空筛选" aria-label="清空筛选" onClick={onClearFilters}>
                    <X />
                </Button>
            )}
        </div>
    )
}

export type { ImageGenFiltersProps, KindFilter }
