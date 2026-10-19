/**
 * 取名入参归一化：把 Webview 传来的不可信载荷逐字段收窄为 NamingRequest，非法值一律回落默认。
 * 复用约定：枚举合法性由 ../shared/types/naming 与 data/catalog 共同约束，分类变体以 catalog 为准。
 * 关键约束：姓氏与后缀只保留允许字符并限长，具体要求限 150 字，数量上限 48，防止异常载荷放大生成开销。
 */
import { isValidVariant, NAME_COUNTS, NAMING_CATEGORIES, readCategoryDefinition } from './data/catalog'
import type { NamingCategoryDefinition } from './data/catalog'
import type {
    NamingCategory,
    NamingEra,
    NamingGender,
    NamingNameLength,
    NamingReference,
    NamingRequest,
    NamingSource,
    NamingSurnameKind,
} from '../../shared/types/naming'

/** 具体要求最大长度（与界面计数一致） */
const MAX_REQUIREMENT_LENGTH = 150
/** 姓氏最大长度：复姓最多 3 字，西方姓氏放宽到 16 个字符 */
const MAX_SURNAME_LENGTH = 16
/** 后缀最大长度 */
const MAX_SUFFIX_LENGTH = 4
/** 默认批量数量 */
const DEFAULT_COUNT = 24

const ERA_VALUES: readonly NamingEra[] = ['modern', 'ancient']
const REFERENCE_VALUES: readonly NamingReference[] = ['none', 'poem', 'confucian', 'taoist', 'buddhist']
const GENDER_VALUES: readonly NamingGender[] = ['male', 'female', 'neutral']
const LENGTH_VALUES: readonly NamingNameLength[] = ['any', 'one', 'two']
const SURNAME_KIND_VALUES: readonly NamingSurnameKind[] = ['single', 'compound']
const SOURCE_VALUES: readonly NamingSource[] = ['local', 'ai']

/** 收窄取名请求 */
export function normalizeNamingRequest(payload: unknown): NamingRequest {
    const value = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
    const category = readCategory(value.category)
    const definition = readCategoryDefinition(category)
    const variant = readVariant(definition, value.variant)
    return {
        category,
        source: readEnum(value.source, SOURCE_VALUES, 'local'),
        variant,
        era: readEnum(value.era, ERA_VALUES, 'modern'),
        reference: readEnum(value.reference, REFERENCE_VALUES, 'none'),
        gender: readEnum(value.gender, GENDER_VALUES, 'male'),
        length: readEnum(value.length, LENGTH_VALUES, 'any'),
        surnameKind: readEnum(value.surnameKind, SURNAME_KIND_VALUES, 'single'),
        surname: readText(value.surname, MAX_SURNAME_LENGTH),
        suffix: readText(value.suffix, MAX_SUFFIX_LENGTH),
        requirement: readText(value.requirement, MAX_REQUIREMENT_LENGTH),
        count: readCount(value.count),
    }
}

/** 分类：非法值回落到人物 */
function readCategory(input: unknown): NamingCategory {
    return NAMING_CATEGORIES.some((item) => item.value === input) ? (input as NamingCategory) : 'person'
}

/** 变体：非法值回落该分类第一个选项 */
function readVariant(definition: NamingCategoryDefinition, input: unknown): string {
    const [first] = definition.variants
    const fallback = first ? first.value : ''
    if (typeof input !== 'string' || !isValidVariant(definition.value, input)) {
        return fallback
    }
    return input
}

/** 枚举收窄 */
function readEnum<T extends string>(input: unknown, allowed: readonly T[], fallback: T): T {
    return typeof input === 'string' && (allowed as readonly string[]).includes(input) ? (input as T) : fallback
}

/** 文本收窄：去控制字符并限长 */
function readText(input: unknown, maxLength: number): string {
    if (typeof input !== 'string') {
        return ''
    }
    return input
        .replace(/[\p{Cc}]/gu, '')
        .trim()
        .slice(0, maxLength)
}

/** 数量收窄：仅接受候选值，其余取默认 */
function readCount(input: unknown): number {
    return typeof input === 'number' && NAME_COUNTS.includes(input) ? input : DEFAULT_COUNT
}
