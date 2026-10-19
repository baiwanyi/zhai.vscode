/**
 * 取名数据契约：宿主 naming/* 协议与前端取名页共用的请求、结果与选项摘要结构。
 * 复用约定：字段由宿主归一化（非法值回落默认）后使用，前端只负责收集条件与展示结果；
 * 内容库与生成算法均留在宿主，前端不持有词素表，避免双份维护与包体膨胀。
 * 关键约束：request 字段全部为展示无关的枚举值，新增分类须同步 catalog 的 variants 与生成器池键。
 */

/** 取名分类：与左侧分类栏一一对应 */
export type NamingCategory = 'person' | 'place' | 'faction' | 'move' | 'equipment' | 'monster' | 'item'

/** 生成通道：local 为本内容库组合，ai 为模型生成 */
export type NamingSource = 'local' | 'ai'

/** 人物地域：中国 / 西方 / 日本 */
export type NamingPersonRegion = 'cn' | 'west' | 'jp'

/** 时代：现代 / 古代 */
export type NamingEra = 'modern' | 'ancient'

/** 参考典籍：不参考 / 诗词 / 儒家 / 道教 / 佛教 */
export type NamingReference = 'none' | 'poem' | 'confucian' | 'taoist' | 'buddhist'

/** 人物性别 */
export type NamingGender = 'male' | 'female' | 'neutral'

/** 名字字数（不含姓氏） */
export type NamingNameLength = 'any' | 'one' | 'two'

/** 姓氏类型 */
export type NamingSurnameKind = 'single' | 'compound'

/**
 * 取名条件：variant 承载「地域」或「类型」两种语义（人物为 cn/west/jp，地点与势力为 east/west，
 * 招式 / 装备 / 道具 / 怪物为子类型 id），由 catalog 的 variants 描述其取值范围。
 */
export interface NamingRequest {
    category: NamingCategory
    source: NamingSource
    variant: string
    era: NamingEra
    reference: NamingReference
    gender: NamingGender
    length: NamingNameLength
    surnameKind: NamingSurnameKind
    /** 用户指定或「单姓 / 复姓」随机填入的姓氏，空串表示随机 */
    surname: string
    /** 用户指定的后缀（地点 / 势力 / 招式 / 装备 / 怪物 / 道具），空串表示随机 */
    suffix: string
    /** 具体要求：本地通道按标签加权，AI 通道作为氛围描述 */
    requirement: string
    /** 批量数量 */
    count: number
}

/** 生成结果：surname / suffix 供前端做分段高亮 */
export interface NamingCandidate {
    id: string
    name: string
    surname: string | null
    suffix: string | null
}

/** 选项：value 为协议值，label 为界面文案 */
export interface NamingOption {
    value: string
    label: string
}

/** 分类元信息：前端据此决定展示哪些条件字段 */
export interface NamingCategoryMeta {
    value: NamingCategory
    label: string
    /** variant 字段的界面标题，如「地域」「位置」「类型」 */
    variantLabel: string
    variants: NamingOption[]
    /** 是否为人物：决定是否展示时代 / 参考 / 性别 / 字数 / 姓氏 */
    isPerson: boolean
    /** 是否为实体：决定是否展示后缀输入 */
    hasSuffix: boolean
    /** 后缀输入占位与示例 */
    suffixPlaceholder: string
}

/** 取名选项摘要：一次性下发，前端不重复请求 */
export interface NamingCatalog {
    categories: NamingCategoryMeta[]
    eras: NamingOption[]
    references: NamingOption[]
    genders: NamingOption[]
    lengths: NamingOption[]
    surnameKinds: NamingOption[]
    counts: number[]
    /** 后缀候选：键为 `${category}:${variant}`，仅用于「随机」按钮填充 */
    suffixSamples: Record<string, string[]>
    /** 姓氏抽样：用于「单姓 / 复姓」一键随机填充 */
    surnameSamples: { single: string[]; compound: string[] }
    /** AI 通道是否可用（已配置 API Key） */
    aiAvailable: boolean
}

/** 本地生成结果 */
export interface NamingGenerateResult {
    items: NamingCandidate[]
    source: NamingSource
}

/** 历史记录项：一批次一行 */
export interface NamingHistoryEntry {
    id: string
    category: NamingCategory
    source: NamingSource
    names: string[]
    /** 条件摘要（人类可读，如「东方 · 后缀：宫」） */
    summary: string
    createdAt: string
}

/** 收藏项 */
export interface NamingFavoriteItem {
    name: string
    category: NamingCategory
    createdAt: string
}
