/**
 * 取名分类与选项定义：分类元信息、变体（地域 / 类型）、时代、参考典籍、性别、字数、批量数量。
 * 复用约定：宿主据此组装 naming/catalog 摘要下发，前端按元信息决定展示哪些字段，不在前端硬编码分类。
 * 关键约束：变体 value 必须与 cores.ts / suffixes.ts 的池键 `${category}:${variant}` 对应。
 */
import type { NamingCategory, NamingCategoryMeta, NamingOption } from '@shared/types/naming'

/** 分类定义：在共用元信息上补充池键推导所需字段 */
export interface NamingCategoryDefinition extends NamingCategoryMeta {
    /** 后缀池键前缀，即 `${category}:${variant}` 的前半段 */
    poolPrefix: NamingCategory
}

export const NAMING_CATEGORIES: readonly NamingCategoryDefinition[] = [
    {
        value: 'person',
        label: '人物',
        variantLabel: '地域',
        variants: [
            { value: 'cn', label: '中国' },
            { value: 'west', label: '西方' },
            { value: 'jp', label: '日本' },
        ],
        isPerson: true,
        hasSuffix: false,
        suffixPlaceholder: '',
        poolPrefix: 'person',
    },
    {
        value: 'place',
        label: '地点',
        variantLabel: '位置',
        variants: [
            { value: 'east', label: '东方' },
            { value: 'west', label: '西方' },
        ],
        isPerson: false,
        hasSuffix: true,
        suffixPlaceholder: '选填，如「宫」',
        poolPrefix: 'place',
    },
    {
        value: 'faction',
        label: '势力',
        variantLabel: '位置',
        variants: [
            { value: 'east', label: '东方' },
            { value: 'west', label: '西方' },
        ],
        isPerson: false,
        hasSuffix: true,
        suffixPlaceholder: '选填，如「阁」',
        poolPrefix: 'faction',
    },
    {
        value: 'move',
        label: '招式',
        variantLabel: '类型',
        variants: [
            { value: 'wuxia', label: '武功' },
            { value: 'cultivation', label: '修真' },
            { value: 'magic', label: '魔法' },
        ],
        isPerson: false,
        hasSuffix: true,
        suffixPlaceholder: '选填，如「掌」',
        poolPrefix: 'move',
    },
    {
        value: 'equipment',
        label: '装备',
        variantLabel: '类型',
        variants: [
            { value: 'cold', label: '冷兵器' },
            { value: 'hot', label: '热兵器' },
            { value: 'armor', label: '护具' },
            { value: 'artifact', label: '法宝' },
        ],
        isPerson: false,
        hasSuffix: true,
        suffixPlaceholder: '选填，如「剑」',
        poolPrefix: 'equipment',
    },
    {
        value: 'monster',
        label: '怪物',
        variantLabel: '类型',
        variants: [
            { value: 'east', label: '东方妖兽' },
            { value: 'west', label: '西方怪物' },
        ],
        isPerson: false,
        hasSuffix: true,
        suffixPlaceholder: '选填，如「兽」',
        poolPrefix: 'monster',
    },
    {
        value: 'item',
        label: '道具',
        variantLabel: '类型',
        variants: [
            { value: 'material', label: '天材地宝' },
            { value: 'pill', label: '丹药' },
            { value: 'west', label: '西方宝物' },
        ],
        isPerson: false,
        hasSuffix: true,
        suffixPlaceholder: '选填，如「丹」',
        poolPrefix: 'item',
    },
]

/** 时代 */
export const ERA_OPTIONS: readonly NamingOption[] = [
    { value: 'modern', label: '现代' },
    { value: 'ancient', label: '古代' },
]

/** 参考典籍 */
export const REFERENCE_OPTIONS: readonly NamingOption[] = [
    { value: 'none', label: '不参考' },
    { value: 'poem', label: '诗词经典' },
    { value: 'confucian', label: '儒家经典' },
    { value: 'taoist', label: '道教经典' },
    { value: 'buddhist', label: '佛教经典' },
]

/** 性别 */
export const GENDER_OPTIONS: readonly NamingOption[] = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'neutral', label: '中性' },
]

/** 名字字数（不含姓氏） */
export const LENGTH_OPTIONS: readonly NamingOption[] = [
    { value: 'any', label: '不限' },
    { value: 'one', label: '1 字' },
    { value: 'two', label: '2 字' },
]

/** 姓氏类型 */
export const SURNAME_KIND_OPTIONS: readonly NamingOption[] = [
    { value: 'single', label: '单姓' },
    { value: 'compound', label: '复姓' },
]

/** 批量数量候选 */
export const NAME_COUNTS: readonly number[] = [12, 24, 48]

/** 实体组合规则：coreCount 为意象词素段数区间，maxLength 为整体字数上限 */
export const ENTITY_RULES: Readonly<
    Record<NamingCategory, { coreCount: readonly [number, number]; maxLength: number }>
> = {
    person: { coreCount: [1, 2], maxLength: 12 },
    place: { coreCount: [1, 1], maxLength: 7 },
    faction: { coreCount: [1, 1], maxLength: 8 },
    move: { coreCount: [1, 2], maxLength: 8 },
    equipment: { coreCount: [1, 2], maxLength: 8 },
    monster: { coreCount: [1, 2], maxLength: 8 },
    item: { coreCount: [1, 2], maxLength: 9 },
}

/** 按分类取定义：未知分类回落到第一个分类，保证界面不空白 */
export function readCategoryDefinition(category: NamingCategory): NamingCategoryDefinition {
    const matched = NAMING_CATEGORIES.find((item) => item.value === category)
    if (matched) {
        return matched
    }
    const [fallback] = NAMING_CATEGORIES
    if (!fallback) {
        throw new Error('取名分类配置为空')
    }
    return fallback
}

/** 判断变体是否属于该分类（Webview 入参收窄用） */
export function isValidVariant(category: NamingCategory, variant: string): boolean {
    return readCategoryDefinition(category).variants.some((item) => item.value === variant)
}
